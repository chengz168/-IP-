const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {LocalAsr,validateResult,runWorker}=require('../server/local-asr.cjs');
const {Providers}=require('../server/providers.cjs');
const {createService}=require('../server/service.cjs');

test('本地识别保留可追溯的逐词凭据，非法词轴不能写入执行结果',()=>{
 const words=[{start:.2,end:.8,word:'真实'},{start:.8,end:1.2,word:'时间。'}],data={text:'真实时间。',segments:[{start:0,end:1.3,text:'真实时间。',words}]};
 assert.deepEqual(validateResult(data,1.3).segments[0].words,words);
 assert.throws(()=>validateResult({...data,segments:[{...data.segments[0],words:[{start:0,end:1,word:'漏字'}]}]},1.3),/词级文字/);
});

test('本地识别仅接受非空、有序且未超时长的真实时间轴',()=>{
  const valid={text:'  已有语音。 ',language:'zh',segments:[{start:.1,end:1,text:' 已有语音。 '}]};
  assert.equal(validateResult(valid,1).segments[0].text,'已有语音。');
  for(const change of [{text:''},{segments:[]},{segments:[{start:-1,end:1,text:'负数'}]},{segments:[{start:0,end:3,text:'超时长'}]},{segments:[{start:0,end:.5,text:'第一句'},{start:.4,end:1,text:'重叠'}]},{segments:[{start:0,end:.5,text:' '}]}])assert.throws(()=>validateResult({...valid,...change},1));
  assert.equal(validateResult({...valid,segments:[{start:.1,end:1.05,text:'尾帧'}]},1).segments[0].end,1);
});

test('本地配置缺模型或不是完整Python路径时在启动前失败',()=>{
  const provider={asrPythonPath:'python',asrModelPath:'small'},recognizer=new LocalAsr({data:{settings:{provider}}});
  assert.throws(()=>recognizer.options(),/完整路径/);
  provider.asrPythonPath=process.execPath;provider.asrModelPath=path.join(os.tmpdir(),'missing-asr-model');
  assert.throws(()=>recognizer.options(),/不会自动下载/);
});

test('选择本地识别不会回退到云端；未知协议明确拒绝',async()=>{
  const config={asrProtocol:'local-whisper'},provider=new Providers({data:{settings:{provider:config}}},null,{get:async()=>{throw new Error('不应读取密钥');}});
  let called=false;provider.localRecognizer={transcribe:async(id,ctx)=>{called=true;return {sourceAssetId:id,signal:ctx.signal};}};
  provider.request=()=>{throw new Error('不应调用远程接口');};
  const controller=new AbortController(),result=await provider.transcribe('local-video',{signal:controller.signal});
  assert(called);assert.equal(result.sourceAssetId,'local-video');assert.equal(result.signal,controller.signal);
  config.asrProtocol='missing';await assert.rejects(provider.transcribe('local-video',{}),/未知语音识别方式/);
});

test('本地设置保存和旧配置恢复具有独立含义',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'superip-asr-settings-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const service=createService(root);assert.equal(service.store.data.settings.provider.asrProtocol,'compatible');
  await service.invoke('saveSettings',{outputDir:'',provider:{asrProtocol:'local-whisper',asrPythonPath:process.execPath,asrModelPath:root,asrLanguage:'auto'}});
  const saved=JSON.parse(fs.readFileSync(service.store.file,'utf8')).settings.provider;
  assert.equal(saved.asrProtocol,'local-whisper');assert.equal(saved.asrPythonPath,process.execPath);assert.equal(saved.asrLanguage,'auto');assert.equal(saved.asrModel,'');
});

test('识别结果不覆盖切换任务、更换视频和期间编辑的内容',async()=>{
  const {recognitionSnapshot,canApplyRecognition}=await import('../src/recognition-state.js');
  const d={id:'a',sourceUrl:'url',sourceText:'旧文',edit:{sourceId:'v1',captions:[]},video:{assetId:''}};
  const snapshot=recognitionSnapshot(d,'transcribe'),extract=recognitionSnapshot(d,'extract');
  assert(canApplyRecognition(snapshot,d));d.edit.sourceId='v2';assert(!canApplyRecognition(snapshot,d));d.edit.sourceId='v1';d.edit.captions=[{start:0,end:1,text:'手改'}];assert(!canApplyRecognition(snapshot,d));
  d.sourceText='新写';assert(!canApplyRecognition(extract,d));d.sourceText='旧文';d.id='b';assert(!canApplyRecognition(extract,d));
});

test('子进程启动失败可结束，预先取消不会启动进程',async()=>{
  await assert.rejects(runWorker(path.join(os.tmpdir(),'no-superip-python.exe'),[],{},1000),/未找到/);
  const controller=new AbortController();controller.abort();assert.throws(()=>runWorker(process.execPath,[],{signal:controller.signal}),/abort/i);
});
