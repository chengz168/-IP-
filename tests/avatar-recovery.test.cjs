const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createService}=require('../server/service.cjs'),{Store,createDraft}=require('../server/store.cjs'),{avatarContext}=require('../server/avatar-request.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'avatar-recovery-')),prior=new Set(process.listeners('exit')),s=createService(root),listener=process.listeners('exit').find(fn=>!prior.has(fn));
 t.after(()=>{process.removeListener('exit',listener);fs.rmSync(root,{recursive:true,force:true});});
 const asset=name=>{const file=path.join(root,name);fs.writeFileSync(file,'协议单测夹具，不是真实媒体');return s.store.addAsset(file);},audio=asset('input.wav'),video=asset('shape.mp4'),d=s.store.draft();
 s.store.data.avatars=[{id:'shape',assetId:video.id}];s.store.data.settings.provider.avatarUrl='http://127.0.0.1:1/avatar';Object.assign(d.video,{avatarId:'shape',audioId:audio.id});
 const run={id:'remote-run',draftId:d.id,type:'avatar',status:'unknown',progress:20,createdAt:'2026-11-14T00:00:00Z',endedAt:'2026-11-14T00:01:00Z',error:'原始中断说明',remoteId:'remote-job',remote:{kind:'avatar-bridge-v1',statusUrl:'http://127.0.0.1:1/status'},snapshot:structuredClone(d),parameters:{input:avatarContext(s.store,d).input},logs:[]};s.store.data.runs=[run];s.store.save();
 const calls=[];let result={status:'succeeded',jobId:run.remoteId,videoUrl:'http://127.0.0.1:1/result'};
 s.providers.request=async(url,options)=>{calls.push({url,method:options?.method||'GET'});return url.endsWith('/status')?{json:async()=>result}:{arrayBuffer:async()=>Buffer.from('协议返回夹具，不是真实视频')};};s.media.probe=async()=>({streams:[{codec_type:'video'}],format:{duration:'2'}});
 return {s,d,run,audio,video,calls,setResult:value=>result=value};
}
test('提交时持久化查询地址，停止及重启后仍可只GET取回既有任务',async t=>{
 const {s,d}=fixture(t);s.store.data.runs=[];let posts=0;
 s.providers.request=async()=>{posts++;return {json:async()=>({jobId:'persisted-id',status:'running',statusUrl:'http://127.0.0.1:1/status'})};};
 const pending=s.handlers.avatar({id:d.id});await new Promise(resolve=>setImmediate(resolve));const original=s.store.data.runs[0];s.runtime.cancel(original.id);await assert.rejects(pending);
 s.store.data=new Store(s.store.root).data;const run=s.store.data.runs[0];assert.equal(run.remoteId,'persisted-id');assert.equal(run.remote.statusUrl,'http://127.0.0.1:1/status');assert.equal(run.status,'unknown');
 const methods=[];s.providers.request=async(url,options)=>{methods.push(options?.method||'GET');return url.endsWith('/status')?{json:async()=>({status:'succeeded',videoUrl:'http://127.0.0.1:1/result'})}:{arrayBuffer:async()=>Buffer.from('协议夹具')};};
 const result=await s.invoke('queryAvatarResult',{runId:run.id});assert.equal(result.attached,true);assert.equal(posts,1);assert.deepEqual(methods,['GET','GET']);assert.equal(s.store.data.runs.length,1);assert.equal(run.unresolvedHistory.status,'unknown');
});
test('仍在排队或处理中仅查询一次，保留待确认与实际进度且不下载',async t=>{
 const {s,run,calls,setResult}=fixture(t);for(const status of ['queued','running']){setResult({status,progress:43});assert.equal((await s.invoke('queryAvatarResult',{runId:run.id})).status,'pending');assert.equal(run.status,'unknown');assert.equal(run.progress,43);}
 assert.equal(calls.length,2);assert(calls.every(c=>c.method==='GET'));assert.equal(run.remoteChecks.length,2);
});
test('取回有效结果原子绑定并清理下游引用，保留原中断证据且不抢当前任务',async t=>{
 const {s,d,run,calls}=fixture(t),other=createDraft();s.store.data.drafts.push(other);s.store.data.currentId=other.id;d.edit.resultId='old-edit';d.publish.videoId='old-edit';s.store.save();
 const result=await s.invoke('queryAvatarResult',{runId:run.id});assert(result.attached);assert.equal(s.store.draft(d.id).video.assetId,result.asset.id);assert.equal(s.store.draft(d.id).edit.resultId,'');assert.equal(s.store.draft(d.id).publish.videoId,'');assert.equal(s.store.data.currentId,other.id);assert.equal(run.unresolvedHistory.error,'原始中断说明');assert.equal(run.unresolvedHistory.endedAt,'2026-11-14T00:01:00Z');assert.equal(run.status,'succeeded');assert(calls.every(c=>c.method==='GET'));
});
for(const status of ['failed','cancelled'])test('服务明确'+status+'才解除待确认，并让原自动流程等待人工重新启动',async t=>{
 const {s,d,run,setResult}=fixture(t);s.store.data.workflowJobs=[{id:'workflow',draftId:d.id,status:'unknown',stages:[{key:'avatar',runId:run.id,status:'unknown'}]}];setResult({status,error:'真实服务返回原因'});
 assert.equal((await s.invoke('queryAvatarResult',{runId:run.id})).status,status);assert.equal(run.status,status);assert.equal(run.error,'真实服务返回原因');assert.equal(run.unresolvedHistory.error,'原始中断说明');assert.notEqual(s.store.data.workflowJobs[0].status,'unknown');assert.equal(s.store.data.assets.length,2);assert.equal((await s.invoke('state')).taskSummaries[0].deletable,true);
});
test('缺查询地址的历史任务明确拒绝，不猜地址且不发请求',async t=>{
 const {s,run,calls}=fixture(t);delete run.remote;await assert.rejects(s.invoke('queryAvatarResult',{runId:run.id}),/未保存远程查询地址/);assert.equal(calls.length,0);assert.equal(run.status,'unknown');
});
test('同一记录并发查询拒绝，查询中备份拒绝，取消后可继续查询',async t=>{
 const {s,run}=fixture(t);s.providers.request=(_,__,ctx)=>new Promise((resolve,reject)=>ctx.signal.addEventListener('abort',()=>reject(Error('中止')),{once:true}));
 const pending=s.invoke('queryAvatarResult',{runId:run.id});await assert.rejects(s.invoke('queryAvatarResult',{runId:run.id}),/正在查询/);await assert.rejects(s.invoke('backup'),/任务正在执行/);s.runtime.cancel(run.id);await assert.rejects(pending,/已停止本地查询/);assert.equal(run.status,'unknown');assert.equal(s.avatarRecovery.controllers.size,0);assert.equal(s.runtime.controllers.size,0);
 s.providers.request=async()=>({json:async()=>({status:'running'})});assert.equal((await s.invoke('queryAvatarResult',{runId:run.id})).status,'pending');
});
for(const kind of ['模型','地址','源文件','当前视频','查询期间换视频'])test(kind+'变化时取回结果只存素材库，不覆盖当前产物',async t=>{
 const {s,d,run,audio}=fixture(t);if(kind==='模型')d.video.model='v1';if(kind==='地址')s.store.data.settings.provider.avatarUrl='http://127.0.0.1:2/changed';if(kind==='源文件')fs.appendFileSync(audio.path,'变化');if(kind==='当前视频')d.video.assetId='manual-new';
 if(kind==='查询期间换视频'){const original=s.providers.request;s.providers.request=async(...args)=>{d.video.assetId='during-query';return original(...args);};}
 const expected=d.video.assetId,result=await s.invoke('queryAvatarResult',{runId:run.id});assert.equal(result.attached,false);assert.equal(result.asset.stale,true);assert.equal(s.store.draft(d.id).video.assetId,kind==='查询期间换视频'?'during-query':expected);assert.equal(run.status,'succeeded');assert(s.store.asset(result.asset.id));
});
for(const kind of ['未知状态','无效对象','错任务ID','网络错误','下载错误','无效媒体'])test(kind+'仍保留unknown，失败不新增资产且允许再次查询',async t=>{
 const {s,run,setResult}=fixture(t),before=s.store.data.assets.length;
 if(kind==='未知状态')setResult({status:'mystery'});if(kind==='无效对象')setResult(null);if(kind==='错任务ID')setResult({status:'running',jobId:'wrong'});if(kind==='网络错误')s.providers.request=async()=>{throw Error('连接失败');};if(kind==='下载错误'){const original=s.providers.request;s.providers.request=(url,...args)=>url.endsWith('/result')?Promise.reject(Error('下载失败')):original(url,...args);}if(kind==='无效媒体')s.media.probe=async()=>({streams:[{codec_type:'audio'}],format:{duration:2}});
 await assert.rejects(s.invoke('queryAvatarResult',{runId:run.id}));assert.equal(run.status,'unknown');assert.equal(s.store.data.assets.length,before);assert.equal(run.remoteChecks.length,1);assert.equal(fs.readdirSync(s.store.outputDir()).length,0);
});
test('结果提交写盘失败时回滚状态、任务、资产文件及原磁盘JSON',async t=>{
 const {s,d,run}=fixture(t),before=JSON.parse(fs.readFileSync(s.store.file,'utf8')),files=fs.readdirSync(s.store.assetDir).sort(),save=s.store.save.bind(s.store);let calls=0;s.store.save=()=>{calls++;throw Error('受控写盘失败');};
 await assert.rejects(s.invoke('queryAvatarResult',{runId:run.id}),/写盘失败/);s.store.save=save;assert.equal(calls,1);assert.equal(run.status,'unknown');assert.equal(s.store.draft(d.id).video.assetId,'');assert.equal(s.store.data.assets.length,2);assert.deepEqual(fs.readdirSync(s.store.assetDir).sort(),files);assert.deepEqual(JSON.parse(fs.readFileSync(s.store.file,'utf8')),before);assert.deepEqual(s.store.data,before);
});
test('正常提交已拿到远程ID后下载失败应保留unknown，避免重新提交重复任务',async t=>{
 const {s,d}=fixture(t);s.store.data.runs=[];s.providers.request=async(url,options)=>options?.method==='POST'?{json:async()=>({jobId:'existing-job',status:'succeeded',statusUrl:'http://127.0.0.1:1/status',videoUrl:'http://127.0.0.1:1/result'})}:Promise.reject(Error('下载失败'));
 await assert.rejects(s.invoke('avatar',{id:d.id}),/下载失败/);assert.equal(s.store.data.runs[0].status,'unknown');assert.equal(s.store.data.runs[0].remoteId,'existing-job');await assert.rejects(s.invoke('avatar',{id:d.id}),/远程结果待确认/);
});
test('同创作任务的不同远程记录也不能同时恢复，避免两个结果竞争绑定',async t=>{
 const {s,run}=fixture(t),other={...structuredClone(run),id:'second-unknown',remoteId:'second-job'};s.store.data.runs.push(other);let release;s.providers.request=async()=>new Promise(resolve=>release=()=>resolve({json:async()=>({status:'running'})}));
 const pending=s.invoke('queryAvatarResult',{runId:run.id});await assert.rejects(s.invoke('queryAvatarResult',{runId:other.id}),/已有远程结果正在查询/);release();await pending;
});
test('成功取回自动任务产物后仅解除未知状态，不自动继续制作阶段',async t=>{
 const {s,d,run}=fixture(t);s.store.data.workflowJobs=[{id:'workflow',draftId:d.id,status:'unknown',error:'原自动流程中断',stages:[{key:'avatar',runId:run.id,status:'unknown'},{key:'render',status:'pending'}]}];
 const result=await s.invoke('queryAvatarResult',{runId:run.id}),job=s.store.data.workflowJobs[0];assert(result.attached);assert.equal(job.status,'interrupted');assert.equal(job.stages[0].status,'succeeded');assert.equal(job.stages[1].status,'pending');assert.match(job.error,/自动流程未继续/);assert.equal(s.workflows.controllers.size,0);
});
test('下载探测期间停止查询不留下资产或引用，原远程任务继续待确认',async t=>{
 const {s,d,run}=fixture(t);let finishProbe,started;s.media.probe=()=>new Promise(resolve=>{finishProbe=()=>resolve({streams:[{codec_type:'video'}],format:{duration:'2'}});started?.();});const barrier=new Promise(resolve=>started=resolve);
 const pending=s.invoke('queryAvatarResult',{runId:run.id});await barrier;s.runtime.cancel(run.id);finishProbe();await assert.rejects(pending,/已停止本地查询/);assert.equal(run.status,'unknown');assert.equal(s.store.draft(d.id).video.assetId,'');assert.equal(s.store.data.assets.length,2);assert.equal(fs.readdirSync(s.store.outputDir()).length,0);
});
test('已拿远程ID时第一次保存查询元数据失败，最终记录仍是unknown并阻止重复提交',async t=>{
 const {s,d}=fixture(t);s.store.data.runs=[];const save=s.store.save.bind(s.store);let failed=false;
 s.store.save=()=>{if(!failed&&s.store.data.runs[0]?.remoteId){failed=true;throw Error('受控远程元数据保存失败');}return save();};
 s.providers.request=async()=>({json:async()=>({jobId:'already-submitted',status:'running',statusUrl:'http://127.0.0.1:1/status'})});
 await assert.rejects(s.invoke('avatar',{id:d.id}),/元数据保存失败/);assert.equal(s.store.data.runs[0].status,'unknown');assert.equal(JSON.parse(fs.readFileSync(s.store.file,'utf8')).runs[0].status,'unknown');await assert.rejects(s.invoke('avatar',{id:d.id}),/远程结果待确认/);
});
