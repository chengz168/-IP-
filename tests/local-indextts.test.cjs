const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {runInference,runtimeOptions,upstreamCommit,inspectEnvironment,LocalIndexTTS,validateMastering}=require('../server/local-indextts.cjs');
const manifest=require('../integrations/indextts-local/model-manifest.json');
const {execFileSync}=require('node:child_process');
const {speechContext,speechRequest,speechCurrent}=require('../server/speech-request.cjs');

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'superip-local-speech-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const reference=path.join(root,'reference.wav');fs.writeFileSync(reference,'输入指纹测试夹具，不是实际音频');
 const data={settings:{provider:{ttsProtocol:'indextts-local',indexttsHome:root,model:'unrelated'}},
  voices:[{id:'voice',sampleId:'sample'}],assets:[{id:'sample',type:'audio',path:reference}]};
 const draft={finalText:'新文案',language:'中文',voice:{profile:'voice',speed:1,model:'fast',emotion:'happy',strength:.7}};
 return {root,reference,data,draft};
}

test('本地声音请求包含参考内容指纹和情绪强度，同一ID的样本变更也使旧结果过期',t=>{
 const {reference,data,draft}=fixture(t),request=speechRequest(draft,speechContext(data));
 assert.equal(request.seed,42);assert.equal(request.referenceId,'sample');assert.equal(request.referenceSha256.length,64);
 assert.equal(request.language,'ZH');assert.equal(request.strength,.7);
 data.settings.provider.model='changed-unused';data.settings.provider.baseUrl='unused';assert(speechCurrent(request,draft,data));
 draft.voice.strength=.8;assert(!speechCurrent(request,draft,data));draft.voice.strength=.7;
 fs.writeFileSync(reference,'文件已经被替换');assert(!speechCurrent(request,draft,data));
});

test('本地模型允许未有远程ID的参考样本，语言和情绪按实际能力拦截',async t=>{
 const {data,draft}=fixture(t),{speechInput,speechGenerationReason,speechCapabilities}=await import('../server/speech-config.mjs');
 const p=data.settings.provider;
 assert.equal(speechGenerationReason(draft,p,data.voices),'');assert.equal(speechInput(draft,p).model,'IndexTTS-2.5');
 assert.equal(speechCapabilities(p).modelRouting,false);assert.equal(speechCapabilities(p).emotions,true);
 assert.match(speechGenerationReason(draft,p,[]),/样本/);
 assert.throws(()=>speechInput({...draft,language:'韩语'},p),/语言/);
 assert.throws(()=>speechInput({...draft,voice:{...draft.voice,strength:Infinity}},p),/强度/);
 assert.throws(()=>speechInput({...draft,voice:{...draft.voice,emotion:'unknown'}},p),/情绪/);
});

test('本地声音只接受已完成且提交一致的独立环境',t=>{
 const {root}=fixture(t);assert.throws(()=>runtimeOptions({indexttsHome:root}),/未安装完成/);
 const python=path.join(root,'upstream','.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
 fs.mkdirSync(path.dirname(python),{recursive:true});fs.writeFileSync(python,'路径检查夹具');
 fs.writeFileSync(path.join(root,'setup.json'),JSON.stringify({upstream_revision:'wrong'}));
 assert.throws(()=>runtimeOptions({indexttsHome:root}),/版本/);
 fs.writeFileSync(path.join(root,'setup.json'),JSON.stringify({upstream_revision:upstreamCommit}));
 assert.equal(runtimeOptions({indexttsHome:root}).python,python);
});

test('取消本地推理必须等真实子进程退出，取消后没有迟到文件',async t=>{
 const {root}=fixture(t),script=path.join(root,'delayed.cjs'),ready=path.join(root,'ready'),late=path.join(root,'late');
 fs.writeFileSync(script,"const fs=require('node:fs');fs.writeFileSync(process.argv[2],'ready');setTimeout(()=>fs.writeFileSync(process.argv[3],'late'),3000);");
 const controller=new AbortController();
 const pending=runInference(process.execPath,[],{signal:controller.signal},{commandArgs:[script,ready,late]});
 const rejection=assert.rejects(pending,/已取消/);
 for(let i=0;!fs.existsSync(ready)&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,20));
 assert(fs.existsSync(ready),'子进程确实启动后才进行取消验证');controller.abort();await rejection;
 assert.equal(fs.existsSync(late),false);
});

test('本地推理超时会终止子进程并报告失败，不返回成功',async t=>{
 const {root}=fixture(t),script=path.join(root,'hang.cjs');fs.writeFileSync(script,'setInterval(()=>{},1000)');
 await assert.rejects(runInference(process.execPath,[],{},{commandArgs:[script],timeout:120}),/超过允许时限/);
});

test('Windows取消同时停止解释器派生的真实进程，不能遗留后台写入',{skip:process.platform!=='win32'},async t=>{
 const {root}=fixture(t),launcher=path.join(root,'launcher.cjs'),worker=path.join(root,'worker.cjs'),ready=path.join(root,'child-ready'),late=path.join(root,'child-late'),trigger=path.join(root,'after-cancel-trigger');
 // 取消完成后才触发写入，不把机器负载造成的启动或调度延迟当成后台遗留。
 fs.writeFileSync(worker,"const fs=require('node:fs');fs.writeFileSync(process.argv[2],String(process.pid));setInterval(()=>{if(fs.existsSync(process.argv[4]))fs.writeFileSync(process.argv[3],'late');},20);");
 fs.writeFileSync(launcher,"require('node:child_process').spawn(process.execPath,process.argv.slice(2),{stdio:'ignore',windowsHide:true});setInterval(()=>{},1000);");
 const controller=new AbortController(),pending=runInference(process.execPath,[],{signal:controller.signal},{commandArgs:[launcher,worker,ready,late,trigger]}),rejection=assert.rejects(pending,/已取消/);
 for(let i=0;i<100&&!fs.existsSync(ready);i++)await new Promise(resolve=>setTimeout(resolve,20));
 assert(fs.existsSync(ready),'派生进程已实际开始运行');controller.abort();await rejection;
 const workerPid=Number(fs.readFileSync(ready,'utf8'));assert(Number.isInteger(workerPid)&&workerPid>0);
 const {spawnSync}=require('node:child_process');
 const check=spawnSync('powershell.exe',['-NoProfile','-Command',`Get-Process -Id ${workerPid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id`],{encoding:'utf8',windowsHide:true});
 assert.equal(check.error,undefined);assert.equal(check.stdout.trim(),'','取消完成后派生进程必须已退出');
 fs.writeFileSync(trigger,'取消已完成');await new Promise(resolve=>setTimeout(resolve,1800));assert.equal(fs.existsSync(late),false);
});

function fillEnvironment(root){
 const put=(file,contents='文件检查夹具，不是模型权重')=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,contents);};
 put(path.join(root,'upstream','.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'));
 put(path.join(root,'setup.json'),JSON.stringify({upstream_revision:upstreamCommit}));
 for(const name of [...manifest.required,...manifest.alternatives.map(item=>item.files[0])])put(path.join(root,'upstream','checkpoints',name));
 put(path.join(root,manifest.receipt),'{}');
 return put;
}

test('旧声音请求不能混入量化前峰值策略，新收据缺项或超幅必须拒绝',t=>{
 const {data,draft}=fixture(t),request=speechRequest(draft,speechContext(data)),policy=request.audioPolicy;
 assert.equal(request.version,'speech-request-v4');assert.equal(policy,'vocoder-before-limit-peak-0.95-v2');
 const old={...request,version:'speech-request-v2'};delete old.audioPolicy;assert.equal(speechCurrent(old,draft,data),false);
 const valid={policy,stages:[{sourcePeak:1.9,gain:.5,targetPeak:.95,location:'bigvgan.conv_post-before-clamp'}]};
 validateMastering(valid,policy);
 for(const receipt of [undefined,{...valid,policy:'old'},{policy,stages:[]},{policy,stages:[null]},
  {policy,stages:[{sourcePeak:1.9,gain:1,targetPeak:.95}]},{policy,stages:[{sourcePeak:Infinity,gain:.5,targetPeak:.95}]}]){
  assert.throws(()=>validateMastering(receipt,policy),/量化前/);
 }
 const previous={...request,version:'speech-request-v3',audioPolicy:'vocoder-before-pcm-peak-0.95-v1'};assert.equal(speechCurrent(previous,draft,data),false);
});

test('依赖未完成也能返回全部缺项，不启动解释器或创建输出',async t=>{
 const {root}=fixture(t),store={data:{settings:{provider:{indexttsHome:root}}},outputDir(){assert.fail('文件缺项时不应创建检查目录');}};
 const result=await new LocalIndexTTS(store,{}).check();
 assert.equal(result.ready,false);assert.equal(result.readyForProbe,false);assert.equal(result.inferenceVerified,false);
 assert.equal(result.cuda,null);assert.equal(result.pythonPresent,false);assert.equal(result.setupPresent,false);
 assert.equal(result.missingModels.length,manifest.required.length+manifest.alternatives.length+1);
 assert(result.issues.some(item=>item.includes('setup.json')));
 assert.equal(fs.existsSync(path.join(root,'upstream')),false);
});

test('损坏、空或错误版本的安装记录都不能触发运行时检查',t=>{
 const {root}=fixture(t);fillEnvironment(root);
 for(const value of ['','{bad json','null',JSON.stringify({upstream_revision:'wrong'})]){
  fs.writeFileSync(path.join(root,'setup.json'),value);
  const r=inspectEnvironment({indexttsHome:root});
  assert.equal(r.dependenciesInstalled,false);assert.equal(r.readyForProbe,false);assert.equal(r.ready,false);
  assert(r.issues.length>0);assert.deepEqual(r.missingModels,[]);
 }
});

test('空权重和空下载记录仍算缺失，另一个非空w2v权重可替代',t=>{
 const {root}=fixture(t),put=fillEnvironment(root),base=path.join(root,'upstream','checkpoints');
 put(path.join(base,'gpt.pth'),'');put(path.join(base,manifest.alternatives[0].files[0]),'');put(path.join(root,manifest.receipt),'');
 let r=inspectEnvironment({indexttsHome:root});
 assert.deepEqual(r.missingModels,['gpt.pth',manifest.alternatives[0].label,'downloads.json (download completion record)']);
 put(path.join(base,manifest.alternatives[0].files[1]));
 r=inspectEnvironment({indexttsHome:root});assert.equal(r.missingModels.includes(manifest.alternatives[0].label),false);
 assert.equal(r.readyForProbe,false);
});

test('静态文件齐备只允许后续检查，不冒认CUDA或真实推理通过',t=>{
 const {root}=fixture(t);fillEnvironment(root);
 const r=inspectEnvironment({indexttsHome:root});
 assert.equal(r.dependenciesInstalled,true);assert.equal(r.readyForProbe,true);assert.deepEqual(r.issues,[]);
 assert.equal(r.cuda,null);assert.equal(r.torch,null);assert.equal(r.ready,false);assert.equal(r.inferenceVerified,false);
 assert.throws(()=>inspectEnvironment({indexttsHome:'relative/path'}),/完整路径/);
});

test('Node与Python共用清单，缺失、空权重和替代权重的诊断一致',t=>{
 const {root}=fixture(t),put=fillEnvironment(root),base=path.join(root,'upstream','checkpoints');
 const code='import sys,json;from pathlib import Path;sys.path.insert(0,sys.argv[1]);from common import missing_models;print(json.dumps(missing_models(Path(sys.argv[2]))))';
 const pythonMissing=()=>JSON.parse(execFileSync('python',['-c',code,path.resolve('integrations/indextts-local/scripts'),root],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
 assert.deepEqual(pythonMissing(),inspectEnvironment({indexttsHome:root}).missingModels);
 fs.rmSync(path.join(base,'codec.pth'));put(path.join(base,manifest.alternatives[0].files[0]),'');put(path.join(root,manifest.receipt),'');
 assert.deepEqual(pythonMissing(),inspectEnvironment({indexttsHome:root}).missingModels);
 put(path.join(base,manifest.alternatives[0].files[1]));
 assert.deepEqual(pythonMissing(),inspectEnvironment({indexttsHome:root}).missingModels);
});
