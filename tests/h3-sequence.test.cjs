const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {segmentPlan,multiShotPlan,digest,h3Prompt}=require('../server/h3-plan.cjs');
const {H3Sequence}=require('../server/h3-sequence.cjs');
const {createService}=require('./support/licensed-service.cjs');
const {avatarContext}=require('../server/avatar-request.cjs');
const {Store}=require('../server/store.cjs');

test('长音轨分段完整覆盖采样和画面帧，短尾与非整帧长度不丢失或重复',()=>{
 for(const duration of [15.001,16,19.999,20.1,29.3,61.234,121.999]){
  const pcm=Buffer.alloc(Math.ceil(duration*32000)*2),plan=segmentPlan(pcm);let sample=0,frame=0;
  for(const segment of plan.segments){assert.equal(segment.startSample,sample);assert.equal(segment.startFrame,frame);assert(segment.duration>=3.99&&segment.duration<=12.01);sample=segment.endSample;frame=segment.endFrame;}
  assert.equal(sample,pcm.length/2);assert.equal(frame,plan.totalFrames);assert(frame/24>=plan.duration);assert(frame/24-plan.duration<1/24);
 }
 assert.throws(()=>segmentPlan(Buffer.alloc(32000*2*15)),/超过15秒/);
});

test('静音附近切段不删气口；官方结构提示词不硬编码性别、衣服或未核对对白',()=>{
 const pcm=Buffer.alloc(32000*2*18);for(let i=0;i<pcm.length/2;i++)pcm.writeInt16LE(6000,i*2);
 pcm.fill(0,Math.floor(8.4*32000)*2,Math.floor(8.8*32000)*2);
 const plan=segmentPlan(pcm);assert.equal(plan.segments[0].boundary,'silence');assert(plan.segments[0].duration>=8.4&&plan.segments[0].duration<=8.8);
 const prompt=h3Prompt(8.5);assert(prompt.startsWith('For the target video, at 0.00 seconds'));
 assert(prompt.indexOf('integrated_multimodal_description:')<prompt.indexOf('overall_soundscape:'));assert(prompt.indexOf('overall_soundscape:')<prompt.indexOf('non_diegetic_music:'));
 assert(!prompt.includes('<d>')&&!prompt.includes('woman')&&!prompt.includes('white shirt'));assert(prompt.includes('8.50 seconds'));
});

test('多镜头按累计时长切帧且每个音频采样覆盖一次，均分舍入只调整最后边界',()=>{
 for(const [duration,lengths]of [[17.31025,[8.7,8.6]],[28,[20,8]],[.3,[.1,.2]],[31.123,[6.1,18,7]],[1,[1]]]){
  const pcm=Buffer.alloc(Math.round(duration*32000)*2),plan=multiShotPlan(pcm,lengths.map((duration,i)=>({avatarId:'shape-'+i,duration})));let frame=0,sample=0;
  assert.equal(plan.shots.length,lengths.length);
  for(const part of plan.segments){assert.equal(part.startFrame,frame);assert.equal(part.startSample,sample);assert(part.endFrame>frame);assert(part.endSample>sample);assert(part.duration<=15.001);assert.equal(part.frameCount,part.endFrame-part.startFrame);frame=part.endFrame;sample=part.endSample;}
  assert.equal(frame,plan.totalFrames);assert.equal(sample,pcm.length/2);assert.equal(plan.shots.at(-1).endFrame,frame);
  assert.deepEqual(plan.shots.map(s=>s.requestedDuration),lengths);
 }
 const long=multiShotPlan(Buffer.alloc(28*32000*2),[{avatarId:'a',duration:20},{avatarId:'b',duration:8}]);assert.deepEqual(long.segments.map(s=>s.shotIndex),[0,0,1]);assert.equal(long.segments[1].boundary,'shot');
});

test('多镜头时长不足、超长、量化为空及失效参数明确拒绝，不能重复或截断音频凑时长',()=>{
 const pcm=Buffer.alloc(10*32000*2);
 for(const shots of [[],[{avatarId:'a',duration:9}],[{avatarId:'a',duration:11}],[{avatarId:'a',duration:NaN}],[{avatarId:'a',duration:Infinity}],[{avatarId:'a',duration:-1}],[{avatarId:'a',duration:'10'}],[{avatarId:'',duration:10}],[{avatarId:'a',duration:.001},{avatarId:'b',duration:9.999}]])assert.throws(()=>multiShotPlan(pcm,shots));
});

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'h3-sequence-')),prior=new Set(process.listeners('exit')),service=createService(root);
 const listener=process.listeners('exit').find(fn=>!prior.has(fn));t.after(()=>{process.removeListener('exit',listener);fs.rmSync(root,{recursive:true,force:true});});
 const file=(name,data='协议测试夹具，非实际媒体')=>{const target=path.join(root,name);fs.writeFileSync(target,data);return target;};
 const image=file('reference.png'),fullAudio=file('driver.s16le',Buffer.alloc(16*32000*2)),original=file('original.wav'),video=file('shape.mp4');
 const plan={...segmentPlan(fs.readFileSync(fullAudio)),id:'plan-id',directory:root,baseUrl:'http://127.0.0.1:8188',image,imageSha256:digest(fs.readFileSync(image)),fullAudio,fullAudioSha256:digest(fs.readFileSync(fullAudio)),sourceAudio:original,inputAudio:original,sourceAudioSha256:digest(fs.readFileSync(original)),sourceVideo:video,sourceVideoSha256:digest(fs.readFileSync(video)),portrait:true};
 for(const part of plan.segments){part.audio=file('driver-'+part.index+'.wav');part.audioSha256=digest(fs.readFileSync(part.audio));}
 const remote={kind:'comfy-h3-sequence-v1',baseUrl:plan.baseUrl,statusUrl:plan.baseUrl+'/history',plan,planSha256:digest(plan),segments:plan.segments.map(part=>({index:part.index,status:'planned',attempts:[]}))};
 const calls=[],h3={upload:async(base,target)=>{calls.push('upload');return {name:path.basename(target),subfolder:'own',type:'input',sha256:digest(fs.readFileSync(target))};},submit:async()=>{calls.push('submit');return 'new-model-id';},query:async id=>({jobId:id,status:'failed',error:'明确失败测试夹具'}),discover:async()=>{calls.push('discover');return 'original-model-id';}};
 const draft=service.store.draft(),audioAsset=service.store.addAsset(original),videoAsset=service.store.addAsset(video);service.store.data.avatars=[{id:'shape',assetId:videoAsset.id}];
 Object.assign(service.store.data.settings.provider,{avatarProtocol:'comfy-h3',avatarUrl:plan.baseUrl});Object.assign(draft.video,{avatarId:'shape',audioId:audioAsset.id});
 const run={id:'run-id',draftId:draft.id,type:'avatar',status:'unknown',remoteId:plan.id,remote,parameters:{input:avatarContext(service.store,draft).input},snapshot:structuredClone(draft),progress:0};service.store.data.runs=[run];service.store.save();
 const ctx={signal:new AbortController().signal,remote:(id,value)=>{run.remoteId=id;run.remote=structuredClone(value);service.store.save();}};
 const sequence=new H3Sequence(service.store,service.media,h3);return {root,service,draft,run,remote,ctx,h3,calls,sequence,file};
}

test('只读查询遇到未提交分段立即等待明确继续，不上传、不生成',async t=>{
 const f=fixture(t),result=await f.sequence.execute(f.remote,f.ctx);
 assert.equal(result.status,'awaiting_continue');assert.deepEqual(f.calls,[]);assert.equal(f.run.status,'unknown');
});

test('长片提交前凭据已落盘；回包丢失后重开只定位原任务，不重交',async t=>{
 const f=fixture(t);
 f.h3.submit=async()=>{
  f.calls.push('submit');const saved=JSON.parse(fs.readFileSync(f.service.store.file,'utf8')).runs[0];
  assert.equal(saved.remote.segments[0].status,'submitting');assert(saved.remote.segments[0].remote.graphSha256);
  throw Object.assign(Error('提交回包丢失夹具'),{unknown:true});
 };
 await assert.rejects(f.sequence.execute(f.remote,f.ctx,{submit:true}),/回包丢失/);assert.equal(f.calls.filter(call=>call==='submit').length,1);
 const reopened=new Store(f.root);assert.equal(reopened.data.runs[0].remote.segments[0].status,'submitting');
 f.h3.query=async id=>({jobId:id,status:'queued'});
 const result=await f.sequence.execute(f.run.remote,f.ctx);assert.equal(result.status,'pending');assert.equal(f.run.remote.segments[0].remoteId,'original-model-id');
 assert.equal(f.calls.filter(call=>call==='submit').length,1);assert.equal(f.calls.filter(call=>call==='discover').length,1);
});

test('确认失败只保留状态；显式继续才能重试，并保存原失败尝试',async t=>{
 const f=fixture(t),first=await f.sequence.execute(f.remote,f.ctx,{submit:true});assert.equal(first.status,'awaiting_continue');assert(first.error);
 assert.equal(f.calls.filter(call=>call==='submit').length,1);assert.equal(f.run.remote.segments[0].status,'failed');
 await f.sequence.execute(f.run.remote,f.ctx);assert.equal(f.calls.filter(call=>call==='submit').length,1);
 await f.sequence.execute(f.run.remote,f.ctx,{submit:true,retry:true});assert.equal(f.calls.filter(call=>call==='submit').length,2);
 assert.equal(f.run.remote.segments[0].attempts.length,1);assert.equal(f.run.remote.segments[0].attempts[0].remoteId,'new-model-id');
});

test('已成功片段不重交；完成文件或计划被修改必须拒绝',async t=>{
 const f=fixture(t),output=f.file('completed.mp4');f.remote.segments[0]={index:0,status:'succeeded',attempts:[],output:{path:output,sha256:digest(fs.readFileSync(output))}};
 assert.equal((await f.sequence.execute(f.remote,f.ctx)).status,'awaiting_continue');assert.deepEqual(f.calls,[]);
 fs.appendFileSync(output,'变更');await assert.rejects(f.sequence.execute(f.remote,f.ctx,{submit:true}),/片段文件/);assert.deepEqual(f.calls,[]);
 f.remote.plan.duration=999;await assert.rejects(f.sequence.execute(f.remote,f.ctx),/计划指纹/);
});

test('提交前保存失败阻止POST，原文件变更阻止后续生成',async t=>{
 const f=fixture(t),ctx={...f.ctx,remote:()=>{throw Error('保存失败夹具');}};
 await assert.rejects(f.sequence.execute(f.remote,ctx,{submit:true}),/保存失败/);assert(!f.calls.includes('submit'));
 fs.appendFileSync(f.remote.plan.sourceVideo,'变更');await assert.rejects(f.sequence.execute(f.remote,f.ctx,{submit:true}),/形象文件已变化/);assert(!f.calls.includes('submit'));
});

test('恢复入口区分查询和明确继续，停止或改动输入时不能提交后续段',async t=>{
 const f=fixture(t),options=[];
 f.service.providers.comfyH3=()=>({sequence:()=>({execute:async(remote,ctx,option)=>{options.push(option);ctx.beforeSubmit();return {jobId:remote.plan.id,status:'awaiting_continue',progress:0};}})});
 assert.equal((await f.service.invoke('queryAvatarResult',{runId:f.run.id,continueSequence:true})).status,'awaiting_continue');assert.equal(options[0].submit,false);
 assert.equal((await f.service.invoke('continueAvatarSegments',{runId:f.run.id})).status,'awaiting_continue');assert.equal(options[1].submit,true);
 f.service.store.draft().video.model='changed';await assert.rejects(f.service.invoke('continueAvatarSegments',{runId:f.run.id}),/原输入或配置已变化/);assert.equal(options.length,2);
});

test('真实分段执行器的pending状态经恢复入口返回处理中，不误判未知协议',async t=>{
 const f=fixture(t);Object.assign(f.run.remote.segments[0],{status:'accepted',remoteId:'existing-id',remote:{baseUrl:f.remote.baseUrl}});
 f.h3.query=async id=>({jobId:id,status:'running'});f.service.providers.comfyH3=()=>({sequence:()=>f.sequence});
 const result=await f.service.invoke('queryAvatarResult',{runId:f.run.id});assert.equal(result.status,'pending');assert.equal(f.run.status,'unknown');assert.deepEqual(f.calls,[]);
});

function continuityFixture(t){
 const f=fixture(t);f.remote.plan.referencePolicy='previous-planned-last-frame-v1';f.remote.planSha256=digest(f.remote.plan);
 const output=f.file('prior-generated.mp4');f.remote.segments[0]={index:0,status:'succeeded',attempts:[],output:{path:output,sha256:digest(fs.readFileSync(output))}};
 f.referenceCount=0;f.sequence.extractReference=async(remote,index)=>{
  f.referenceCount++;assert.equal(index,1);assert.equal(remote.segments[0].output.path,output);
  const file=f.file('actual-join-frame.png','协议夹具，非实际PNG');
  return {path:file,sha256:digest(fs.readFileSync(file)),sourceSegment:0,sourceSha256:remote.segments[0].output.sha256,frame:remote.plan.segments[0].frameCount-1};
 };
 return f;
}

test('分段真实执行生命周期在提交前连接、ID返回后绑定，换段和结束关闭旧观察',async t=>{
 const f=fixture(t),observed=[],order=[];
 f.h3.observe=async(remote,ctx,details)=>{
  const entry={clientId:remote.clientId,...details,closed:false,ids:[]};observed.push(entry);order.push('open');
  return {bind:id=>{entry.ids.push(id);order.push('bind');},check(){},collecting(){order.push('collect');},close(){entry.closed=true;order.push('close');}};
 };
 f.h3.submit=async()=>{order.push('submit');return 'model-'+observed.length;};f.h3.query=async id=>({jobId:id,status:'succeeded'});
 f.sequence.download=async(result,remote,index)=>{const file=f.file('new-output-'+index+'.mp4');return {path:file,sha256:digest(fs.readFileSync(file))};};
 const result=await f.sequence.execute(f.remote,f.ctx,{submit:true});
 assert.equal(result.status,'succeeded');assert.equal(observed.length,f.remote.segments.length);
 assert(observed.every((entry,index)=>entry.closed&&entry.segmentIndex===index&&entry.segmentCount===observed.length&&entry.ids.every(id=>id==='model-'+(index+1))));
 assert.equal(new Set(observed.map(entry=>entry.clientId)).size,observed.length);
 assert.deepEqual(order.slice(0,3),['open','submit','bind']);assert.equal(order.at(-1),'close');
});

test('分段回包丢失与只读查询均关闭观察；查询不提交模型任务',async t=>{
 const f=fixture(t),closed=[];
 f.h3.observe=async remote=>({bind(){},check(){},collecting(){},close(){closed.push(remote.clientId);}});
 f.h3.submit=async()=>{f.calls.push('submit');throw Object.assign(Error('丢失回包'),{unknown:true});};
 await assert.rejects(f.sequence.execute(f.remote,f.ctx,{submit:true}),/丢失回包/);assert.equal(closed.length,1);
 f.h3.query=async id=>({jobId:id,status:'running'});
 const result=await f.sequence.execute(f.run.remote,f.ctx);assert.equal(result.status,'pending');assert.equal(closed.length,2);assert.equal(f.calls.filter(c=>c==='submit').length,1);
});

function multiFixture(t,lengths=[8,8]){
 const f=fixture(t),pcm=Buffer.alloc(Math.round(lengths.reduce((a,b)=>a+b,0)*32000)*2);fs.writeFileSync(f.remote.plan.fullAudio,pcm);
 const secondVideo=f.file('second-shape.mp4'),secondImage=f.file('second-reference.png'),second=f.service.store.addAsset(secondVideo);
 f.service.store.data.avatars.push({id:'second-shape',assetId:second.id});
 const shots=lengths.map((duration,i)=>({avatarId:i===lengths.length-1?'second-shape':'shape',duration}));
 const timeline=multiShotPlan(pcm,shots),plan={...f.remote.plan,...timeline,mode:'multi',fullAudioSha256:digest(pcm),referencePolicy:'shot-first-frame-with-continuations-v1'};
 plan.shots=timeline.shots.map(shot=>{const last=shot.avatarId==='second-shape',image=last?secondImage:plan.image,sourceVideo=last?secondVideo:plan.sourceVideo;return {...shot,image,imageSha256:digest(fs.readFileSync(image)),sourceVideo,sourceVideoSha256:digest(fs.readFileSync(sourceVideo))};});
 for(const part of plan.segments){part.audio=f.file('multi-driver-'+part.index+'.wav');part.audioSha256=digest(fs.readFileSync(part.audio));}
 Object.assign(f.remote,{plan,planSha256:digest(plan),segments:plan.segments.map(part=>({index:part.index,status:'planned',attempts:[]}))});
 Object.assign(f.draft.video,{mode:'multi',shots});f.run.parameters.input=avatarContext(f.service.store,f.draft).input;f.service.store.save();
 f.complete=index=>{const file=f.file('multi-output-'+index+'.mp4');f.remote.segments[index]={...f.remote.segments[index],index,status:'succeeded',output:{path:file,sha256:digest(fs.readFileSync(file))}};};
 return f;
}

test('本地多镜头以首个实际镜头为基础形象，未使用的旧单形象不影响有效输入',t=>{
 const f=multiFixture(t),before=avatarContext(f.service.store,f.draft).input;
 f.draft.video.avatarId='不存在的旧选择';assert.deepEqual(avatarContext(f.service.store,f.draft).input,before);
 f.draft.video.shots.reverse();assert.notDeepEqual(avatarContext(f.service.store,f.draft).input,before);
});

test('切镜使用该镜头自己的首帧，查询不提帧不提交，失败重试仍复用同一镜头输入',async t=>{
 const f=multiFixture(t),uploaded=[];f.complete(0);f.sequence.extractReference=()=>assert.fail('切镜不能继承上一形象末帧');
 const upload=f.h3.upload;f.h3.upload=async(base,file,...args)=>{uploaded.push(file);return upload(base,file,...args);};
 assert.equal((await f.sequence.step(f.remote,f.ctx)).status,'awaiting_continue');assert.deepEqual(f.calls,[]);
 await f.sequence.step(f.remote,f.ctx,{submit:true});assert.equal(uploaded[0],f.remote.plan.shots[1].image);assert.equal(f.run.remote.segments[1].reference,undefined);
 await f.sequence.step(f.run.remote,f.ctx,{submit:true,retry:true});assert.equal(uploaded[2],uploaded[0]);assert.equal(f.run.remote.segments[1].attempts.length,1);
});

test('同一长镜头内部保存末帧后再提交，进入下一镜头后恢复独立形象首帧',async t=>{
 const f=multiFixture(t,[20,8]),uploaded=[];f.complete(0);let extracted=0;
 f.sequence.extractReference=async(remote,index)=>{extracted++;assert.equal(index,1);const file=f.file('multi-continuity.png');return {path:file,sha256:digest(fs.readFileSync(file)),sourceSegment:0,sourceSha256:remote.segments[0].output.sha256,frame:remote.plan.segments[0].frameCount-1};};
 const upload=f.h3.upload;f.h3.upload=async(base,file,...args)=>{uploaded.push(file);return upload(base,file,...args);};
 f.h3.query=async id=>({jobId:id,status:'queued'});await f.sequence.step(f.remote,f.ctx,{submit:true});assert.equal(extracted,1);assert.equal(uploaded[0],f.run.remote.segments[1].reference.path);
 f.remote=f.run.remote;f.complete(1);await f.sequence.step(f.remote,f.ctx,{submit:true});assert.equal(extracted,1);assert.equal(uploaded[2],f.remote.plan.shots[1].image);
});

test('多镜头重开只查已有模型任务，图指纹和镜头输入仍与原提交一致',async t=>{
 const f=multiFixture(t);f.h3.query=async id=>({jobId:id,status:'queued'});
 await f.sequence.step(f.remote,f.ctx,{submit:true});const saved=new Store(f.root).data.runs[0].remote;
 assert.equal(saved.segments[0].remote.graph['17'].inputs.image,'own/'+path.basename(saved.plan.shots[0].image));
 await f.sequence.step(saved,f.ctx);assert.equal(f.calls.filter(c=>c==='submit').length,1);
});

test('任一镜头源、首帧或时间轴变更都阻止后续提交，切镜不能带入旧形象衔接凭据',async t=>{
 for(const which of ['source','image','timeline','reference']){
  const f=multiFixture(t);f.complete(0);
  if(which==='source')fs.appendFileSync(f.remote.plan.shots[1].sourceVideo,'源变化');
  if(which==='image')fs.appendFileSync(f.remote.plan.shots[1].image,'图变化');
  if(which==='timeline'){f.remote.plan.segments[1].startFrame++;f.remote.planSha256=digest(f.remote.plan);}
  if(which==='reference')f.remote.segments[1].reference={path:f.remote.plan.image};
  await assert.rejects(f.sequence.step(f.remote,f.ctx,{submit:true}));assert(!f.calls.includes('submit'));
 }
});

test('衔接首帧先保存再上传；只读查询不提帧或提交，确认失败重试复用同一依据',async t=>{
 const f=continuityFixture(t),uploaded=[];
 assert.equal((await f.sequence.step(f.remote,f.ctx)).status,'awaiting_continue');assert.equal(f.referenceCount,0);
 const upload=f.h3.upload;f.h3.upload=async(base,file,...args)=>{
  const saved=JSON.parse(fs.readFileSync(f.service.store.file,'utf8')).runs[0].remote;
  assert.equal(saved.segments[1].reference.frame,saved.plan.segments[0].frameCount-1);
  uploaded.push(file);return upload(base,file,...args);
 };
 await f.sequence.step(f.remote,f.ctx,{submit:true});assert.equal(f.referenceCount,1);
 const reference=structuredClone(f.run.remote.segments[1].reference);
 assert.equal(uploaded[0],reference.path);assert.notEqual(uploaded[0],f.remote.plan.image);
 await f.sequence.step(f.run.remote,f.ctx,{submit:true,retry:true});
 assert.equal(f.referenceCount,1);assert.deepEqual(f.run.remote.segments[1].reference,reference);assert.equal(uploaded[2],reference.path);
 assert.equal(f.calls.filter(call=>call==='submit').length,2);assert.equal(f.run.remote.segments[0].remoteId,undefined);
});

test('衔接首帧保存失败不上传或提交，错帧号或图像被改动须拒绝',async t=>{
 const f=continuityFixture(t);
 await assert.rejects(f.sequence.step(f.remote,{...f.ctx,remote:()=>{throw Error('衔接保存失败夹具');}},{submit:true}),/保存失败/);
 assert(!f.calls.includes('upload'));assert(!f.calls.includes('submit'));
 const reference=await f.sequence.extractReference(f.remote,1);f.remote.segments[1].reference=reference;
 reference.frame++;assert.throws(()=>f.sequence.validate(f.remote),/衔接首帧/);reference.frame--;
 fs.appendFileSync(reference.path,'图像变化');assert.throws(()=>f.sequence.validate(f.remote),/衔接首帧/);
});

test('重开保留衔接参考与原ID；已提交但缺参考记录不能偷偷改用原形象',async t=>{
 const f=continuityFixture(t);f.h3.query=async id=>({jobId:id,status:'queued'});
 const result=await f.sequence.step(f.remote,f.ctx,{submit:true});assert.equal(result.status,'pending');
 const reopened=new Store(f.root),saved=reopened.data.runs[0].remote;
 assert.deepEqual(saved.segments[1].reference,f.run.remote.segments[1].reference);
 await f.sequence.step(saved,f.ctx);assert.equal(f.referenceCount,1);assert.equal(f.calls.filter(call=>call==='submit').length,1);
 delete saved.segments[1].reference;assert.throws(()=>f.sequence.validate(saved),/缺少已经保存/);
});
