const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createService}=require('../server/service.cjs');
const {Providers}=require('../server/providers.cjs');
const logic=import('../server/speech-config.mjs');

test('声音参数严格校验，任务音色优先，只有不同真实模型才启用路由',async()=>{
 const {speechInput,speechCapabilities,emotionOptions}=await logic,config={ttsProtocol:'compatible',ttsModel:'fallback',systemVoice:'全局',ttsClassicModel:'slow-real',ttsFastModel:'fast-real'},draft={finalText:'真实文案',voice:{speed:1.5,model:'classic',systemVoice:'任务'}};
 assert.equal(speechInput(draft,config).model,'slow-real');assert.equal(speechInput(draft,config).systemVoice,'任务');draft.voice.model='fast';assert.equal(speechInput(draft,config).model,'fast-real');assert.equal(speechCapabilities(config).modelRouting,true);assert.equal(speechCapabilities({...config,ttsFastModel:'slow-real'}).modelRouting,false);assert.equal(speechCapabilities({...config,ttsProtocol:'windows'}).modelRouting,false);assert.equal(speechInput(draft,{ttsModel:'fallback'}).model,'fallback');assert.equal(emotionOptions.length,9);assert.equal(emotionOptions[4].label,'害怕');
 for(const speed of [NaN,Infinity,0,.49,2.01,'错误'])assert.throws(()=>speechInput({...draft,voice:{speed}},config),/语速/);
 for(const emotion of ['happy','angry','surprised'])assert.throws(()=>speechInput({...draft,voice:{speed:1,emotion}},config),/不支持情绪|未支持情绪/);
 for(const finalText of ['','   ','字'.repeat(10001)])assert.throws(()=>speechInput({...draft,finalText},config),/文案/);
 assert.throws(()=>speechInput({...draft,voice:{speed:1,model:'made-up'}},config),/模型选项/);
});

test('兼容语音请求确实选择对应模型和语速，无音轨响应不入库',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-tts-route-'));try{
  const config={baseUrl:'http://127.0.0.1:1/v1',ttsModel:'fallback',ttsClassicModel:'real-classic',ttsFastModel:'real-fast',voice:'remote-voice'},requests=[],assets=[];
  let valid=true;const provider=new Providers({data:{settings:{provider:config},voices:[]},outputDir:()=>root,addAsset:(file,extra)=>{assets.push(extra);return {id:String(assets.length),...extra};}},{probe:async()=>({streams:valid?[{codec_type:'audio'}]:[{codec_type:'video'}],format:{duration:1.2}})},{get:async()=>''});
  provider.request=async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return {arrayBuffer:async()=>Buffer.from('仅验证协议的模拟数据，非真实媒体')};};
  const d={finalText:'文案',voice:{model:'classic',speed:1.5}};await provider.speech(d,{signal:new AbortController().signal});d.voice.model='fast';await provider.speech(d,{});
  assert.deepEqual(requests.map(r=>r.body.model),['real-classic','real-fast']);assert(requests.every(r=>r.body.voice==='remote-voice'&&r.body.speed===1.5));assert.equal(assets[0].speech.model,'real-classic');assert.equal(assets[0].speech.textLength,2);
  valid=false;await assert.rejects(provider.speech(d,{}),/有效音轨/);assert.equal(assets.length,2);
  const before=requests.length;d.voice.emotion='happy';await assert.rejects(provider.speech(d,{}),/情绪/);assert.equal(requests.length,before);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('零帧系统WAV缺失时长必须拒绝，不能把NaN存成成功产物',async()=>{
 const {speechDuration}=await logic;for(const duration of [undefined,null,'N/A','NaN',Infinity,0,-1])assert.throws(()=>speechDuration({streams:[{codec_type:'audio'}],format:{duration}}),/有效音轨/);assert.throws(()=>speechDuration({streams:[{codec_type:'video'}],format:{duration:1}}));assert.equal(speechDuration({streams:[{codec_type:'audio'}],format:{duration:'1.5'}}),1.5);
});

test('正式配音及试听共用去重，试听不绑定正式音频且过期正式结果不覆盖',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-tts-runs-')),service=createService(root);try{
  const d=service.store.draft();d.finalText='初始文案';d.voice.audioId='原配音';service.store.save();let finish,received;
  service.providers.speech=async draft=>{received=draft;return new Promise(resolve=>finish=resolve);};
  const preview=service.handlers.testSpeech({id:d.id,text:'试听',speed:1.25,profile:'',systemVoice:'任务音色'});
  await assert.rejects(service.handlers.speech({id:d.id}),/已有语音/);assert.equal(received.voice.systemVoice,'任务音色');assert.equal(received.voice.emotion,'');finish({id:'试听素材'});await preview;assert.equal(d.voice.audioId,'原配音');
  const generation=service.handlers.speech({id:d.id});await assert.rejects(service.handlers.testSpeech({id:d.id,text:'重复',speed:1,profile:''}),/已有语音/);d.finalText='处理过程中修改文案';finish({id:'旧文本产物'});const result=await generation;assert.equal(result.stale,true);assert.equal(d.voice.audioId,'原配音');
  service.store.data.runs.unshift({draftId:d.id,type:'speech',status:'unknown'});await assert.rejects(service.handlers.speech({id:d.id}),/已有语音/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('声音样本校验实际音轨和大小，保存失败回滚资源，不冒认训练',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-voice-sample-')),service=createService(root);try{
  const d=service.store.draft(),file=path.join(root,'sample.wav');fs.writeFileSync(file,'仅测试元数据验证，不冒充真实音频');const asset=service.store.addAsset(file);
  service.media.probe=async()=>({streams:[],format:{duration:1}});await assert.rejects(service.handlers.importVoiceSample({id:d.id,name:'无音轨',sampleId:asset.id}),/没有实际音轨/);assert.equal(service.store.data.voices.length,0);
  service.media.probe=async()=>({streams:[{codec_type:'audio'}],format:{duration:1.2}});
  for(const name of ['', '字'.repeat(11)])await assert.rejects(service.handlers.importVoiceSample({id:d.id,name,sampleId:asset.id}),/声音名称/);
  const originalSave=service.store.save.bind(service.store);service.store.save=()=>{if(service.store.data.voices.length)throw Error('模拟资源持久化失败');return originalSave();};await assert.rejects(service.handlers.importVoiceSample({id:d.id,name:'保存失败',sampleId:asset.id}),/持久化失败/);assert.equal(service.store.data.voices.length,0);service.store.save=originalSave;
  const result=await service.handlers.importVoiceSample({id:d.id,name:'真实样本入口',sampleId:asset.id});assert.equal(result.trained,false);assert.equal(result.resource.status,'sample-only');assert.equal(result.resource.sourceId,asset.id);assert.equal(Object.hasOwn(result.resource,'remoteId'),false);
  const large=path.join(root,'large.wav');const fd=fs.openSync(large,'w');fs.ftruncateSync(fd,50*1024*1024+1);fs.closeSync(fd);const largeAsset=service.store.addAsset(large);await assert.rejects(service.handlers.importVoiceSample({id:d.id,name:'超限',sampleId:largeAsset.id}),/50MB/);assert.equal(service.store.data.voices.length,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
