const fs=require('node:fs');
const {avatarCurrent}=require('./avatar-request.cjs');

class AvatarRecovery{
 constructor(service){this.service=service;this.controllers=new Map();}
 async query({runId,continueSequence=false}){
  const {store,runtime,providers}=this.service,run=store.data.runs.find(r=>r.id===runId);
  if(!run||run.type!=='avatar'||run.status!=='unknown'||(!run.remoteId&&!(run.remote?.kind==='comfy-h3-v1'&&run.remote?.clientId&&run.remote?.graph)))throw Error('此执行没有待确认的远程视频任务或完整本地提交凭据');
  if(!['avatar-bridge-v1','comfy-h3-v1','comfy-h3-sequence-v1'].includes(run.remote?.kind)||!run.remote.statusUrl)throw Error('该记录未保存远程查询地址，请保留任务ID联系服务商，不能重新提交代替查询');
  if(continueSequence&&(run.remote.kind!=='comfy-h3-sequence-v1'||!avatarCurrent(run.parameters?.input,store,store.draft(run.draftId))))throw Error('分段生成的原输入或配置已变化，未提交新片段；已有片段仍保留');
  if(this.controllers.has(runId))throw Error('该远程任务正在查询，请等待本次查询结束');
  if([...this.controllers.keys()].some(id=>store.data.runs.find(r=>r.id===id)?.draftId===run.draftId))throw Error('该创作任务已有远程结果正在查询，请等待本次查询结束');
  if(require('./workflow-state.cjs').workflowActive(store.data,run.draftId)||store.data.runs.some(r=>r.id!==runId&&r.draftId===run.draftId&&['running','queued'].includes(r.status)))throw Error('该创作任务正在处理，请结束当前操作后查询远程结果');
  const controller=new AbortController(),ctx={signal:controller.signal},at=new Date().toISOString(),initialVideo=store.draft(run.draftId).video.assetId;let created,commitAttempted=false;
  this.controllers.set(runId,controller);runtime.controllers.set(runId,controller);
  const commit=(patch,attempt,bind=false)=>{
   const beforeRun=structuredClone(run),beforeDraft=structuredClone(store.draft(run.draftId)),beforeJobs=structuredClone(store.data.workflowJobs),beforeCurrent=store.data.currentId;
   commitAttempted=true;
   try{
    // 首次确认前保留原中断状态，后续查询历史只追加，不抹掉最初的错误和结束时间。
    if(patch.status&&patch.status!=='unknown')run.unresolvedHistory??={status:run.status,error:run.error,endedAt:run.endedAt,progress:run.progress};
    Object.assign(run,patch);run.remoteChecks=[...(run.remoteChecks||[]),attempt];
    if(bind){const next=structuredClone(store.draft(run.draftId));next.video.assetId=created.id;store.updateDraft(next,{preserveCurrentId:true,persist:false});}
    for(const job of store.data.workflowJobs||[])if(job.status==='unknown'&&job.draftId===run.draftId&&job.stages?.some(stage=>stage.runId===run.id)&&patch.status&&patch.status!=='unknown'){
     job.remoteResolution={runId:run.id,status:patch.status,checkedAt:at,assetId:created?.id||''};
     job.status=patch.status==='failed'?'failed':'interrupted';job.error=patch.status==='failed'?'远程视频任务已确认失败，请查看执行详情。':'远程结果已确认；自动流程未继续，请核对产物后重新启动。';
     for(const stage of job.stages)if(stage.runId===run.id){stage.status=patch.status==='succeeded'?'succeeded':patch.status;stage.assetId=created?.id||'';stage.error=patch.status==='failed'?run.error:'';}
    }
    store.save();commitAttempted=false;
   }catch(error){
    for(const key of Object.keys(run))delete run[key];Object.assign(run,beforeRun);store.data.drafts[store.data.drafts.findIndex(d=>d.id===run.draftId)]=beforeDraft;store.data.currentId=beforeCurrent;
    if(beforeJobs===undefined)delete store.data.workflowJobs;else store.data.workflowJobs=beforeJobs;
    if(created){store.data.assets=store.data.assets.filter(a=>a.id!==created.id);fs.rmSync(created.path,{force:true});created=undefined;}
    throw error;
   }
  };
  ctx.activity=activity=>{if(!ctx.signal.aborted)commit({activity:structuredClone(activity)},{at:new Date().toISOString(),status:'model-activity'});};
  try{
   let result;
   if(run.remote.kind==='comfy-h3-sequence-v1'){
    ctx.beforeSubmit=()=>{if(!avatarCurrent(run.parameters.input,store,store.draft(run.draftId)))throw Error('分段生成的输入或配置已变化，未提交下一段');};
    ctx.remote=(id,remote)=>{if(id!==run.remote.plan.id)throw Error('分段计划ID不一致');commit({remoteId:id,remote:structuredClone(remote)},{at:new Date().toISOString(),status:'sequence-checkpoint'});};
    ctx.progress=(progress,message)=>commit({progress},{at:new Date().toISOString(),status:'sequence-progress',message});
    result=await providers.comfyH3().sequence().execute(run.remote,ctx,{submit:continueSequence,retry:continueSequence});
   }
   if(run.remote.kind==='comfy-h3-v1'&&!run.remoteId){
    const id=await providers.comfyH3().discover(run.remote,ctx);ctx.signal.throwIfAborted();
    commit({remoteId:id,remote:{...run.remote,statusUrl:run.remote.baseUrl+'/history/'+encodeURIComponent(id),submissionState:'accepted'}},{at,status:'located',remoteId:id});
   }
   if(run.remote.kind==='comfy-h3-v1')result=await providers.comfyH3().query(run.remoteId,run.remote,ctx);
   else if(run.remote.kind!=='comfy-h3-sequence-v1'){const response=await providers.request(run.remote.statusUrl,{headers:await providers.headers()},ctx);result=await response.json();}ctx.signal.throwIfAborted();
   if(!result||typeof result!=='object'||Array.isArray(result))throw Error('查询没有返回有效任务对象，远程结果仍待确认');
   if(result.jobId!==undefined&&result.jobId!==run.remoteId)throw Error('查询返回的任务ID与原记录不一致，远程结果仍待确认');
   const status=result.status;
   if(status==='awaiting_continue'&&run.remote.kind==='comfy-h3-sequence-v1'){
    commit({progress:result.progress},{at,status,error:result.error||''});return {status,progress:result.progress,error:result.error||'',remoteId:run.remoteId};
   }
   if(['queued','running'].includes(status)||(status==='pending'&&run.remote.kind==='comfy-h3-sequence-v1')){
    const progress=typeof result.progress==='number'&&Number.isFinite(result.progress)?Math.max(0,Math.min(99,result.progress)):run.progress;
    commit({progress},{at,status,progress});return {status:'pending',remoteId:run.remoteId,progress};
   }
   if(['failed','cancelled'].includes(status)){
    const error=typeof result.error==='string'&&result.error.trim()?result.error.slice(0,2000):status==='failed'?'远程服务确认视频生成失败':'远程服务确认任务已取消';
    commit({status,error,endedAt:new Date().toISOString(),remoteResolution:{status,checkedAt:at}},{at,status,error});return {status,remoteId:run.remoteId};
   }
   if(status!=='succeeded')throw Error('远程服务返回未识别状态，结果仍待确认');
   created=run.remote.kind==='comfy-h3-sequence-v1'?await providers.comfyH3().sequence().collect(run.remote,run.parameters?.input,ctx,{persist:false}):run.remote.kind==='comfy-h3-v1'?await providers.comfyH3().collect(result,run.remote,run.parameters?.input,ctx,{persist:false}):await providers.downloadAvatar(result,ctx,run.parameters?.input,{persist:false});ctx.signal.throwIfAborted();
   const current=store.draft(run.draftId),busy=require('./workflow-state.cjs').workflowActive(store.data,run.draftId)||store.data.runs.some(r=>r.id!==runId&&r.draftId===run.draftId&&['running','queued'].includes(r.status));
   const stale=!!busy||!run.parameters?.input||!avatarCurrent(run.parameters.input,store,current)||current.video.assetId!==initialVideo||!!initialVideo&&initialVideo!==run.snapshot?.video?.assetId;
   const output={...created,...(stale?{stale:true}:{})};
   commit({status:'succeeded',error:'',progress:100,endedAt:new Date().toISOString(),output,remoteResolution:{status:'succeeded',checkedAt:at,assetId:created.id,attached:!stale}},{at,status:'succeeded',assetId:created.id,attached:!stale},!stale);
   return {status:'succeeded',asset:output,attached:!stale,remoteId:run.remoteId};
  }catch(error){
   if(created){store.data.assets=store.data.assets.filter(a=>a.id!==created.id);fs.rmSync(created.path,{force:true});}
   if(!commitAttempted){const before=run.remoteChecks;run.remoteChecks=[...(before||[]),{at,status:'unknown',error:controller.signal.aborted?'已停止本地查询，远程任务未取消':error.message}];try{store.save();}catch(saveError){if(before===undefined)delete run.remoteChecks;else run.remoteChecks=before;throw saveError;}}
   if(controller.signal.aborted)throw Error('已停止本地查询，远程任务未取消，可稍后再次查询');
   throw error;
  }finally{this.controllers.delete(runId);if(runtime.controllers.get(runId)===controller)runtime.controllers.delete(runId);}
 }
}
module.exports={AvatarRecovery};
