const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {audioPlan,videoPlan,sourceIndex,prepareProductionInput,prepareVideoSource,readPcm}=require('../integrations/musetalk-local/production-input.cjs');
const {Media,runProcess}=require('../server/media.cjs');
const {avatarContext,avatarCurrent}=require('../server/avatar-request.cjs');
const {avatarActionSignature}=require('../src/avatar-action.mjs');
const {createService}=require('../server/service.cjs');
const {Runtime}=require('../server/runtime.cjs');
const {verifyReceipt,runtimeOptions,runWorker}=require('../server/local-musetalk.cjs');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const vm=require('node:vm');

function folder(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'口型 正式输入-'));t.after(()=>fs.rmSync(root,{force:true,recursive:true}));return root;}
test('本地多镜头进度标明当前镜头，单形象文案保持兼容',async()=>{
 const {h3ActivityText}=await import('../server/h3-activity.mjs');
 assert.equal(h3ActivityText({kind:'musetalk-local-v1',stage:'inferred',completed:50,total:149,shotIndex:1,shotCount:2}),'第 2/2 镜头 · 口型生成 50/149 帧');
 assert.equal(h3ActivityText({kind:'musetalk-local-v1',stage:'ready'}),'本地口型环境检查通过');
 assert.equal(h3ActivityText({kind:'musetalk-local-v1',stage:'ready',shotIndex:2,shotCount:2}),'本地口型环境检查通过');
});
test('实际预加载桥接允许环境检查，未知动作仍拒绝',async()=>{
 let exposed,request;
 vm.runInNewContext(fs.readFileSync(path.resolve('electron/preload.cjs'),'utf8'),{require:name=>{
  assert.equal(name,'electron');
  return {contextBridge:{exposeInMainWorld:(name,api)=>{assert.equal(name,'studio');exposed=api;}},ipcRenderer:{invoke:(...args)=>{request=args;return Promise.resolve({kind:'explicit-bridge-fixture'});}}};
 }});
 await exposed.invoke('checkLocalLipSync',{});assert.equal(request[0],'studio:invoke');assert.equal(request[1],'checkLocalLipSync');await assert.rejects(exposed.invoke('unknown-action',{}),/不支持的操作/);
});
test('自动流程的本地口型不依赖云地址，多镜头按实际镜头检查形象',async t=>{
 const root=folder(t),prior=new Set(process.listeners('exit')),s=createService(root),listener=process.listeners('exit').find(fn=>!prior.has(fn));t.after(()=>process.removeListener('exit',listener));
 const draft=s.store.draft();Object.assign(s.store.data.settings.provider,{avatarProtocol:'musetalk-local',avatarUrl:'',musetalkHome:'D:/runtime'});
 let plan=await s.invoke('planWorkflow',{id:draft.id});assert(!plan.issues.some(issue=>issue.includes('口型服务')));
 s.store.data.settings.provider.musetalkHome='';plan=await s.invoke('planWorkflow',{id:draft.id});assert(plan.issues.some(issue=>issue.includes('MuseTalk 环境目录')));
 s.store.data.settings.provider.musetalkHome='D:/runtime';draft.video.mode='multi';plan=await s.invoke('planWorkflow',{id:draft.id});assert(plan.issues.some(issue=>issue.includes('至少保留一个镜头')));
 const source=path.join(root,'shape.mp4');fs.writeFileSync(source,'明确协议夹具');const asset=s.store.addAsset(source);s.store.data.avatars=[{id:'shape',assetId:asset.id}];draft.video.shots=[{avatarId:'shape',duration:1}];draft.video.avatarId='失效的单形象字段';
 plan=await s.invoke('planWorkflow',{id:draft.id});assert(!plan.issues.some(issue=>/镜头|形象视频/.test(issue)));
});
test('任意长度音频不丢尾音，特征静音明确且只增加不到一帧加一个采样',()=>{
 for(const fps of [1,24,25,30,60])for(const samples of [16000,16001,128000,128001,340000,9599999,9600000]){
  const p=audioPlan(samples,fps);assert.equal(p.frameCount,Math.ceil(samples*fps/16000));assert(p.duration>=p.audioDuration);assert(p.featurePaddingSamples>0&&p.featurePaddingSamples<=Math.ceil(16000/fps)+1);assert.equal(Math.floor(p.targetSamples/16000*fps),p.frameCount);
 }
 for(const samples of [0,15999,9600001,NaN,16000.1])assert.throws(()=>audioPlan(samples,30),/1至600/);
});
test('往返映射包含重复端点，208秒不会被裁成源素材长度',()=>{
 assert.deepEqual(Array.from({length:12},(_,i)=>sourceIndex(i,3)),[0,1,2,2,1,0,0,1,2,2,1,0]);
 const p=audioPlan(208*16000,30);assert.equal(p.frameCount,6240);for(let i=0;i<6240;i++)assert(sourceIndex(i,593)>=0&&sourceIndex(i,593)<593);
});
test('工作器严格契约继续拒绝未适配的VFR、非整数帧率、旋转和缺帧数',()=>{
 const picture={codec_type:'video',avg_frame_rate:'30/1',r_frame_rate:'30/1',nb_frames:'593',width:1080,height:1920};
 assert.equal(videoPlan({streams:[picture]}).sourceFrameCount,593);
 for(const patch of [{avg_frame_rate:'30000/1001'},{r_frame_rate:'25/1'},{nb_frames:'N/A'},{width:1081},{tags:{rotate:'90'}}])assert.throws(()=>videoPlan({streams:[{...picture,...patch}]}));
 assert.throws(()=>videoPlan({streams:[picture,picture]}),/唯一视频流/);
});
test('本地口型目录入快照，改目录使迟到结果失效；不要求无关的云地址',async t=>{
 const root=folder(t),prior=new Set(process.listeners('exit')),s=createService(root),listener=process.listeners('exit').find(fn=>!prior.has(fn));t.after(()=>process.removeListener('exit',listener));
 const file=path.join(root,'shape.mp4');fs.writeFileSync(file,'明确的协议夹具');const a=s.store.addAsset(file),draft=s.store.draft();
 s.store.data.avatars=[{id:'shape',assetId:a.id}];draft.video.avatarId='shape';draft.video.audioId=a.id;
 Object.assign(s.store.data.settings.provider,{avatarProtocol:'musetalk-local',avatarUrl:'',musetalkHome:'D:/model-a'});
 const context=avatarContext(s.store,draft),signature=avatarActionSignature(draft,s.store.data);assert.equal(context.input.model,'MuseTalk-1.5');assert.equal(context.input.musetalkHome,'D:/model-a');
 s.store.data.settings.provider.avatarUrl='无关的旧云服务';assert(avatarCurrent(context.input,s.store,draft));assert.equal(signature,avatarActionSignature(draft,s.store.data));
 s.store.data.settings.provider.musetalkHome='D:/model-b';assert(!avatarCurrent(context.input,s.store,draft));assert.notEqual(signature,avatarActionSignature(draft,s.store.data));
 draft.video.mode='multi';assert.throws(()=>avatarContext(s.store,draft),/至少保留一个镜头/);
 draft.video.shots=[{avatarId:'shape',duration:1}];draft.video.avatarId='失效的单形象字段';
 const multi=avatarContext(s.store,draft);assert.equal(multi.input.avatarId,'shape');assert.equal(multi.input.shotAvatars[0].source.path,a.path);assert(avatarCurrent(multi.input,s.store,draft));
 draft.video.shots[0].duration=2;assert(!avatarCurrent(multi.input,s.store,draft));
});
test('本地工作目录持久保存，取消归cancelled且不伪造远程ID',async()=>{
 const store={data:{runs:[]},draft:()=>({}),save(){}},runtime=new Runtime(store);let finish;
 const pending=runtime.run('avatar','draft',{},async ctx=>{ctx.local({directory:'明确夹具目录',pid:123});ctx.activity({kind:'musetalk-local-v1',stage:'inferred',completed:4,total:8});return new Promise(r=>finish=r);});
 const run=store.data.runs[0];assert.equal(run.local.pid,123);assert.equal(run.remoteId,'');assert.match(run.logs[0].message,/口型/);runtime.cancel(run.id);finish({id:'late'});await assert.rejects(pending,/取消/);assert.equal(run.status,'cancelled');assert(!run.output);
});
test('无效回执或仅存在视频文件都不能冒认真实推理',t=>{
 const root=folder(t),worker=path.join(root,'worker'),input=path.join(root,'input');fs.mkdirSync(worker);fs.mkdirSync(input);const plan={frameCount:30,width:32,height:24,fps:30};
 fs.writeFileSync(path.join(input,'input.json'),JSON.stringify(plan));fs.writeFileSync(path.join(worker,'input-snapshot.json'),JSON.stringify(plan));
 const file=path.join(worker,'candidate.mp4');fs.writeFileSync(file,'明确协议夹具，并非视频');
 const receipt={status:'technical-complete',inferenceVerified:true,newVideoGenerated:true,fullDecodeVerified:true,generatedFrames:30,inferenceCalls:8,inputManifestSha256:digest(path.join(input,'input.json')),output:{path:file,frames:30,width:32,height:24,fps:30,sha256:digest(file)}};
 const save=value=>fs.writeFileSync(path.join(worker,'result.json'),JSON.stringify(value));save(receipt);assert.equal(verifyReceipt(worker,plan).inferenceCalls,8);
 for(const change of [{status:'running'},{inferenceVerified:false},{generatedFrames:29},{inferenceCalls:0},{inputManifestSha256:'changed'}]){save({...receipt,...change});assert.throws(()=>verifyReceipt(worker,plan));}
 save(receipt);fs.appendFileSync(file,'变化');assert.throws(()=>verifyReceipt(worker,plan));assert.throws(()=>runtimeOptions({musetalkHome:'relative'}),/完整路径/);
});
test('真实子进程协作取消保留标记，退出后才返回取消',async t=>{
 const root=folder(t),controller=new AbortController();let pid;
 const pending=runWorker({python:process.execPath,args:['-e',"const fs=require('fs');let timer=setInterval(()=>{if(fs.existsSync(process.argv[1])){clearInterval(timer);process.exit(130)}},20)",path.join(root,'cancel.request')],directory:root,signal:controller.signal,onStart:value=>{pid=value;controller.abort();},cancelGrace:1500});
 await assert.rejects(pending,/已取消/);assert(fs.existsSync(path.join(root,'cancel.request')));assert.throws(()=>process.kill(pid,0));
});
test('真实FFmpeg短形象与超过源长的非整帧音轨准备，原输入不变',async t=>{
 const root=folder(t),media=new Media({data:{settings:{}}}),{ffmpeg}=media.binaries();
 try{await media.check();}catch(error){t.skip('媒体工具未配置：'+error.message);return;}
 const video=path.join(root,'形象.mp4'),audio=path.join(root,'驱动.wav');
 await runProcess(ffmpeg,['-v','error','-n','-f','lavfi','-i','testsrc2=size=32x24:rate=30','-t','1','-c:v','libx264','-pix_fmt','yuv420p',video]);
 await runProcess(ffmpeg,['-v','error','-n','-f','lavfi','-i','sine=frequency=400:sample_rate=16000','-t','2.013','-c:a','pcm_s16le',audio]);
 const before=[digest(video),digest(audio)],directory=path.join(root,'input'),plan=await prepareProductionInput({videoPath:video,audioPath:audio,directory,media});
 assert.equal(plan.sourceFrameCount,30);assert.equal(plan.frameCount,61);assert.equal(plan.sourceFramePolicy,'forward-reverse-repeat-endpoints-v1');assert.equal(readPcm(plan.driver.path).samples,plan.targetSamples);assert.deepEqual([digest(video),digest(audio)],before);
 assert.equal(plan.video.path,video);assert.equal(plan.originalVideo.sha256,before[0]);assert.equal(plan.videoPreparation.conversion,'none');
 await assert.rejects(prepareProductionInput({videoPath:video,audioPath:audio,directory,media}),/exist|存在/i);
});
test('真实FFmpeg自动适配29.97、VFR、旋转、奇数画幅与缺帧数，原件hash不变',async t=>{
 const root=folder(t),media=new Media({data:{settings:{}}});try{await media.check();}catch(error){t.skip('媒体工具未配置：'+error.message);return;}const {ffmpeg}=media.binaries();
 const base=path.join(root,'base.mp4');await runProcess(ffmpeg,['-v','error','-n','-f','lavfi','-i','testsrc2=size=48x64:rate=30','-t','1.2','-c:v','libx264','-pix_fmt','yuv420p',base]);
 const cases=[
  {name:'29.97.mp4',args:['-f','lavfi','-i','testsrc2=size=48x64:rate=30000/1001','-t','1.2','-c:v','libx264','-pix_fmt','yuv420p'],fps:30},
  {name:'VFR.mp4',args:['-i',base,'-vf','select=if(lt(n\\,15)\\,1\\,not(mod(n\\,2)))','-fps_mode','vfr','-c:v','libx264'],fps:23},
  {name:'旋转.mp4',args:['-display_rotation:v:0','90','-i',base,'-c','copy'],width:64,height:48},
  {name:'奇数.mp4',args:['-f','lavfi','-i','testsrc=size=33x47:rate=30','-t','1.2','-c:v','libx264','-pix_fmt','yuv444p'],width:32,height:46},
  {name:'缺帧数.mkv',args:['-i',base,'-c','copy']}
 ];
 for(const item of cases){
  const source=path.join(root,item.name);await runProcess(ffmpeg,['-v','error','-n',...item.args,source]);const before=digest(source),output=path.join(root,'normalized-'+cases.indexOf(item)+'.mp4');
  const original=await media.probe(source);assert.throws(()=>videoPlan(original),item.name);
  const prepared=await prepareVideoSource({videoPath:source,normalizedPath:output,media});
  assert.equal(prepared.video.path,output);assert.equal(prepared.originalVideo.sha256,before);assert.equal(digest(source),before);assert.equal(prepared.video.sha256,digest(output));
  assert.equal(prepared.videoPreparation.conversion,'integer-cfr-autorotate-even-size-v1');assert(prepared.videoPreparation.reasons.length);
  if(item.fps)assert.equal(prepared.plan.fps,item.fps,item.name);if(item.width)assert.equal(prepared.plan.width,item.width);if(item.height)assert.equal(prepared.plan.height,item.height);
  assert.deepEqual(videoPlan(await media.probe(output)),prepared.plan);await runProcess(ffmpeg,['-v','error','-xerror','-i',output,'-f','null','-']);
 }
});
test('自动适配取消信号阻止探测和转换，不建立假成功输入',async t=>{
 const root=folder(t),source=path.join(root,'source.mp4');fs.writeFileSync(source,'取消夹具');const controller=new AbortController();controller.abort();
 await assert.rejects(prepareVideoSource({videoPath:source,normalizedPath:path.join(root,'normalized.mp4'),media:{binaries(){throw Error('不应启动媒体进程');}},signal:controller.signal}),/abort/i);
 assert.deepEqual(fs.readdirSync(root),['source.mp4']);
});
test('真实FFmpeg适配转码中取消，保留原件且不写成功清单',async t=>{
 const root=folder(t),media=new Media({data:{settings:{}}});try{await media.check();}catch(error){t.skip('媒体工具未配置：'+error.message);return;}const binaries=media.binaries(),source=path.join(root,'long-29.97.mp4'),audio=path.join(root,'unused.wav');
 await runProcess(binaries.ffmpeg,['-v','error','-n','-f','lavfi','-i','testsrc2=size=256x256:rate=30000/1001','-t','3','-c:v','libx264',source]);fs.writeFileSync(audio,'取消应在处理驱动之前结束');const before=digest(source),controller=new AbortController();let conversionStarted=false;
 const cancellingMedia={binaries:()=>({ffprobe:binaries.ffprobe,get ffmpeg(){conversionStarted=true;setTimeout(()=>controller.abort(),30);return binaries.ffmpeg;}})},directory=path.join(root,'input');
 await assert.rejects(prepareProductionInput({videoPath:source,audioPath:audio,directory,media:cancellingMedia,signal:controller.signal}),/abort/i);
 assert(conversionStarted);assert.equal(digest(source),before);assert(!fs.existsSync(path.join(directory,'input.json')));assert(fs.existsSync(path.join(directory,'preparation-failed.json')));assert(!fs.existsSync(path.join(directory,'audio-16k.wav')));
});
