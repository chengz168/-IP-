const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createService}=require('../server/service.cjs');
const {createDraft}=require('../server/store.cjs');
const {avatarContext,avatarCurrent}=require('../server/avatar-request.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'avatar-request-')),prior=new Set(process.listeners('exit')),s=createService(root),listener=process.listeners('exit').find(fn=>!prior.has(fn));
 t.after(()=>{process.removeListener('exit',listener);fs.rmSync(root,{recursive:true,force:true});});
 const asset=name=>{const file=path.join(root,name);fs.writeFileSync(file,'协议边界夹具，不是真实媒体');return s.store.addAsset(file);};
 const audio=asset('input.wav'),video=asset('shape.mp4'),otherVideo=asset('other.mp4'),d=s.store.draft();
 s.store.data.avatars=[{id:'shape',assetId:video.id},{id:'other',assetId:otherVideo.id}];s.store.data.settings.provider.avatarUrl='http://127.0.0.1:1/avatar';d.video.avatarId='shape';d.video.audioId=audio.id;d.video.assetId='prior';s.store.save();return {s,d,audio,video,otherVideo};
}
for(const kind of ['服务','形象引用','驱动音频文件','形象视频文件','文件删除','模型','镜头资源'])test('生成期间修改'+kind+'时旧视频不绑定',async t=>{
 const {s,d,audio,video,otherVideo}=fixture(t);if(kind==='镜头资源'){d.video.mode='multi';d.video.shots=[{avatarId:'other',duration:2}];}
 let finish,captured;s.providers.avatar=async(_,__,context)=>{captured=context;return new Promise(r=>finish=r);};const pending=s.handlers.avatar({id:d.id});
 if(kind==='服务')s.store.data.settings.provider.avatarUrl='http://127.0.0.1:2/avatar';
 if(kind==='形象引用')s.store.data.avatars[0].assetId=otherVideo.id;
 if(kind==='驱动音频文件')fs.appendFileSync(audio.path,'已改变');
 if(kind==='形象视频文件')fs.appendFileSync(video.path,'已改变');
 if(kind==='文件删除')fs.rmSync(audio.path);
 if(kind==='模型')s.store.draft(d.id).video.model='v1';
 if(kind==='镜头资源')fs.appendFileSync(otherVideo.path,'已改变');
 finish({id:'late-video'});const result=await pending;assert.equal(result.stale,true);assert.equal(s.store.draft(d.id).video.assetId,'prior');assert.equal(captured.input.model,'v2');assert.equal(s.store.data.runs[0].parameters.input.avatarUrl,'http://127.0.0.1:1/avatar');assert.equal(s.store.data.runs[0].output.stale,true);
});
test('相同任务阻止运行、排队和远程未知的重复提交，其他任务独立执行',async t=>{
 const {s,d}=fixture(t);let calls=0,finish;s.providers.avatar=async()=>{calls++;return new Promise(r=>finish=r);};const pending=s.handlers.avatar({id:d.id});await assert.rejects(s.handlers.avatar({id:d.id}),/已有视频生成|远程结果待确认/);assert.equal(calls,1);finish({id:'first'});await pending;
 for(const status of ['queued','unknown']){s.store.data.runs.push({id:status,draftId:d.id,type:'avatar',status,remoteId:'保留的远程ID'});await assert.rejects(s.handlers.avatar({id:d.id}),/远程结果待确认/);s.store.data.runs.pop();}
 const other=createDraft();Object.assign(other.video,{avatarId:d.video.avatarId,audioId:d.video.audioId});s.store.data.drafts.push(other);s.store.data.runs.push({id:'other-run',draftId:d.id,type:'avatar',status:'running'});s.providers.avatar=async()=>({id:'other-output'});await s.handlers.avatar({id:other.id});assert.equal(s.store.draft(other.id).video.assetId,'other-output');
});
test('忽略无关文字模型、形象名称和未使用音频，后台完成不抢当前任务',async t=>{
 const {s,d}=fixture(t),other=createDraft();s.store.data.drafts.push(other);let finish;s.providers.avatar=async()=>new Promise(r=>finish=r);const pending=s.handlers.avatar({id:d.id});s.store.data.settings.provider.model='无关模型';s.store.data.avatars[0].name='仅改名称';s.store.draft(d.id).voice.audioId='未使用的上一步声音';s.store.data.currentId=other.id;finish({id:'valid-output'});const result=await pending;assert(!result.stale);assert.equal(s.store.draft(d.id).video.assetId,'valid-output');assert.equal(s.store.data.currentId,other.id);
});
test('取消在返回前阻止绑定；有远程ID时保留unknown并拒绝重交',async t=>{
 for(const remote of [false,true]){const {s,d}=fixture(t);let finish;s.providers.avatar=async(_,ctx)=>{if(remote)ctx.remote('actual-contract-id');return new Promise(r=>finish=r);};const pending=s.handlers.avatar({id:d.id}),run=s.store.data.runs[0];s.runtime.cancel(run.id);finish({id:'cancelled-output'});await assert.rejects(pending);assert.equal(s.store.draft(d.id).video.assetId,'prior');assert.equal(run.status,remote?'unknown':'cancelled');if(remote){assert.equal(run.remoteId,'actual-contract-id');await assert.rejects(s.handlers.avatar({id:d.id}),/远程结果待确认/);}else{s.providers.avatar=async()=>({id:'retry'});await s.handlers.avatar({id:d.id});assert.equal(s.store.draft(d.id).video.assetId,'retry');}}
});
test('口型桥使用固定资源、地址和模型，并保留安全输入证据',async t=>{
 const {s,d,audio}=fixture(t),context=avatarContext(s.store,d);s.store.data.settings.provider.avatarUrl='http://127.0.0.1:2/changed';d.video.model='changed';s.store.data.settings.provider.apiKey='不可写入证据';let request;
 s.providers.request=async(url,options)=>{if(options?.method==='POST'){request={url,fields:[...options.body.keys()],model:options.body.get('model'),audio:Buffer.from(await options.body.get('audio').arrayBuffer())};return {json:async()=>({videoUrl:'http://127.0.0.1:1/result'})};}return {arrayBuffer:async()=>Buffer.from('协议返回夹具，不是真实口型视频')};};s.media.probe=async()=>({streams:[{codec_type:'video'}],format:{duration:'2'}});
 const output=await s.providers.avatar(d,{},context);assert.equal(request.url,context.avatarUrl);assert.equal(request.model,'v2');assert.deepEqual(request.fields,['audio','video','model','shots']);assert.deepEqual(request.audio,fs.readFileSync(audio.path));assert.deepEqual(output.avatarRequest,context.input);assert(!JSON.stringify(output.avatarRequest).includes('不可写入证据'));assert.equal(avatarCurrent(context.input,s.store,d),false);
});
test('提交前文件被替换、缺资源或缺服务时明确拒绝，不发请求',async t=>{
 const {s,d,audio}=fixture(t),context=avatarContext(s.store,d);let calls=0;s.providers.request=async()=>{calls++;};fs.appendFileSync(audio.path,'替换');await assert.rejects(s.providers.avatar(d,{},context),/文件已变化/);assert.equal(calls,0);s.store.data.settings.provider.avatarUrl='';assert.throws(()=>avatarContext(s.store,d),/接入数字人口型服务/);s.store.data.settings.provider.avatarUrl=context.avatarUrl;d.video.avatarId='missing';assert.throws(()=>avatarContext(s.store,d),/请选择数字人形象/);
});
test('无效返回视频时长被拒绝，不登记成可用视频',async t=>{
 for(const duration of ['0','NaN',undefined]){const {s,d}=fixture(t);s.providers.request=async(_,opts)=>opts?.method==='POST'?{json:async()=>({videoUrl:'http://127.0.0.1:1/result'})}:{arrayBuffer:async()=>Buffer.from('无效视频夹具')};s.media.probe=async()=>({streams:[{codec_type:'video'}],format:{duration}});const count=s.store.data.assets.length;await assert.rejects(s.providers.avatar(d,{}),/有效视频流或时长/);assert.equal(s.store.data.assets.length,count);}
});
