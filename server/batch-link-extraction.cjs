const crypto=require('node:crypto');
const fs=require('node:fs');
const {shareLink,extractionMode}=require('./local-link-extractor.cjs');
const pending=['queued','running','stopping'];
const now=()=>new Date().toISOString();
const copy=value=>structuredClone(value);
const copyFields=['sourceUrl','sourceText','rewrite','finalText','confirmed'];
const draftSnapshot=draft=>Object.fromEntries(copyFields.map(key=>[key,draft[key]]));

function linkItems(input){
 if(typeof input!=='string'&&!Array.isArray(input))throw Error('请提供视频分享文本或链接列表');
 const rows=Array.isArray(input)?input:input.split(/\r?\n/),items=[],seen=new Map();
 if(rows.length>500||typeof input==='string'&&input.length>500000)throw Error('每批最多提取50条链接');
 for(const row of rows){
  if(typeof row!=='string')throw Error('每条链接必须为分享文本');
  if(row.length>10000)throw Error('每条分享文本最多10000字');
  if(!row.trim())continue;
  const matches=row.match(/https?:\/\/[^\s<>"'`\u3000-\u303f\uff00-\uffef]+/gi)||[];
  const entries=matches.length>1?matches:[row];
  for(const entry of entries){
   if(items.length>=50)throw Error('每批最多提取50条链接');
   const item={id:crypto.randomUUID(),originalShareText:entry.trim(),url:'',status:'queued',progress:0,message:'等待提取',text:'',error:''};
   try{item.url=shareLink(entry);if(seen.has(item.url)){item.status='duplicate';item.duplicateOf=seen.get(item.url);item.message='重复链接，本批仅提取一次';}else seen.set(item.url,item.id);}
   catch(error){item.status='failed';item.error=error.message;item.message='链接格式无效';}
   items.push(item);
  }
 }
 if(!items.length)throw Error('请至少填写一个视频分享链接');
 return items;
}

function summarize(batch){
 const counts={total:batch.items.length,queued:0,running:0,succeeded:0,failed:0,cancelled:0,unknown:0,duplicate:0,interrupted:0};
 for(const item of batch.items)if(Object.hasOwn(counts,item.status))counts[item.status]++;
 batch.counts=counts;
 const done=batch.items.reduce((total,item)=>total+(['queued','running'].includes(item.status)?Number(item.progress||0)/100:1),0);
 batch.progress=Math.min(100,Math.floor(done/batch.items.length*100));
 batch.updatedAt=now();
 return batch;
}

class BatchLinkExtraction{
 constructor(service){this.service=service;this.store=service.store;this.active=new Map();this.recover();}
 batches(){return this.store.data.extractionBatches||[];}
 batch(id,batchId){this.store.draft(id);const value=this.batches().find(row=>row.id===batchId&&row.draftId===id);if(!value)throw Error('提取批次不存在，请刷新后重试');return value;}
 save(batch){summarize(batch);this.store.save();}
 recover(){
  let changed=false;
  for(const batch of this.batches()){
   if(!pending.includes(batch.status))continue;
   for(const item of batch.items){
    if(!['queued','running'].includes(item.status))continue;
    const run=this.store.data.runs.find(row=>row.id===item.runId);
    if(run?.status==='succeeded'&&typeof run.output?.text==='string'&&run.output.text.trim()){try{this.output(item,run.output);item.status='succeeded';item.progress=100;}catch(error){item.status='failed';item.error=error.message;item.message='原运行结果已过期，未接收';}}
    else{item.status=run?.status==='unknown'||run?.remoteId?'unknown':'interrupted';item.error=item.status==='unknown'?'程序退出，原远程结果仍待确认，未重新提交':'程序退出，尚未完成，未自动重新提交';item.message=item.error;if(run?.remoteId)item.remoteId=run.remoteId;if(run?.remote)item.remote=copy(run.remote);}
    item.endedAt=now();
   }
   batch.status=batch.items.some(row=>row.status==='unknown')?'unknown':'interrupted';batch.endedAt=now();summarize(batch);changed=true;
  }
  if(changed)this.store.save();
 }
 assertAvailable(id){
  this.store.draft(id);
  if(require('./workflow-state.cjs').workflowActive(this.store.data,id)||(this.store.data.workflowJobs||[]).some(row=>row.draftId===id&&row.status==='unknown'))throw Error('该任务自动流程正在运行或结果待确认，请先处理原任务');
  if(this.batches().some(row=>row.draftId===id&&[...pending,'unknown'].includes(row.status)))throw Error('该任务已有批量提取正在执行或结果待确认，请先停止或核对原任务');
  if(this.store.data.runs.some(row=>row.draftId===id&&['extract','reference-analysis','reference-script'].includes(row.type)&&['running','queued','unknown'].includes(row.status)))throw Error('该任务已有文案提取或远程结果待确认，请先处理原任务');
 }
 assertSourcesAvailable(urls){
  const selected=new Set(urls.filter(Boolean));
  const matches=value=>{try{return selected.has(shareLink(value));}catch{return false;}};
  if(this.batches().some(batch=>batch.items.some(item=>['queued','running','unknown'].includes(item.status)&&matches(item.url)))||this.store.data.runs.some(run=>['queued','running','unknown'].includes(run.status)&&['extract','reference-analysis'].includes(run.type)&&matches(run.parameters?.sourceUrl||run.parameters?.originalShareText||run.snapshot?.sourceUrl)))throw Error('相同来源链接正在处理或远程结果待确认，请核对原任务后再提交');
 }
 status({id,batchId}){this.store.draft(id);if(batchId)return this.reconcile({id,batchId});for(const batch of this.batches().filter(row=>row.draftId===id))this.reconcile({id,batchId:batch.id});return {batches:copy(this.batches().filter(row=>row.draftId===id))};}
 settledStatus(batch){
  if(batch.items.some(item=>item.status==='unknown'))return 'unknown';
  if(batch.items.some(item=>['queued','running'].includes(item.status)))return batch.status;
  const succeeded=batch.items.some(item=>item.status==='succeeded'),incomplete=batch.items.some(item=>['failed','cancelled','interrupted'].includes(item.status));
  return succeeded?(incomplete?'partial':'succeeded'):batch.items.some(item=>item.status==='failed')?'failed':batch.items.some(item=>item.status==='interrupted')?'interrupted':'cancelled';
 }
 reconcile({id,batchId}){
  const batch=this.batch(id,batchId);if(this.active.has(batch.id))return copy(batch);
  const before=copy(batch);let changed=false;
  try{
   for(const item of batch.items){
    if(item.status!=='unknown')continue;
    const run=this.store.data.runs.find(row=>row.id===item.runId&&row.draftId===id&&row.type==='extract');
    if(run&&run.status==='unknown'&&(item.remoteId||'')!==(run.remoteId||'')){item.remoteId=run.remoteId||'';if(run.remote)item.remote=copy(run.remote);changed=true;}
    if(!run||this.service.runtime.controllers.has(run.id)||!['succeeded','failed','cancelled'].includes(run.status))continue;
    if(run.status==='succeeded'){
     try{this.output(item,run.output);item.status='succeeded';item.progress=100;item.message='已按原运行记录收取结果，等待选用';delete item.error;}
     catch(error){item.status='failed';item.error=error.message;item.message='原运行结果已过期或无效，未接收正文';}
    }else{item.status=run.status;item.error=run.error||'';item.message=run.status==='failed'?'原运行记录已确认失败':'原运行记录已确认终止';}
    item.reconciliation={basis:'authoritative-local-run',runId:run.id,status:run.status,observedAt:now()};item.endedAt=run.endedAt||now();changed=true;
   }
   if(changed){batch.status=this.settledStatus(batch);batch.reconciledAt=now();batch.endedAt=now();this.save(batch);}
  }catch(error){for(const key of Object.keys(batch))delete batch[key];Object.assign(batch,before);throw error;}
  return copy(batch);
 }
 confirmTerminated({id,batchId,itemId,expectedRunId,expectedRemoteId,confirmed,note}){
  this.reconcile({id,batchId});const batch=this.batch(id,batchId),item=batch.items.find(row=>row.id===itemId);
  if(!item||item.status!=='unknown'||this.active.has(batch.id))throw Error('该项不是可人工核对的未知任务，请先刷新原任务状态');
  const run=this.store.data.runs.find(row=>row.id===item.runId&&row.draftId===id&&row.type==='extract');
  if(!run||run.status!=='unknown'||this.service.runtime.controllers.has(run.id))throw Error('原任务仍在执行或状态已经变化，请刷新核对');
  if(confirmed!==true||typeof note!=='string'||note.trim().length<8||note.length>2000)throw Error('请明确确认已在远端核对任务终止，并填写8至2000字核对说明');
  if(expectedRunId!==item.runId||typeof expectedRemoteId!=='string'||expectedRemoteId!==(run.remoteId||item.remoteId||''))throw Error('原任务凭据已变化，请重新核对后确认');
  const beforeBatch=copy(batch),beforeRun=copy(run),receipt={basis:'user-confirmed-remote-termination',confirmed:true,note:note.trim(),runId:run.id,remoteId:run.remoteId||item.remoteId||'',confirmedAt:now(),limitation:'仅依据用户已在远端核对的人工回执，程序未查询或自动验证远端终止'};
  const unresolved={status:run.status,error:run.error||'',endedAt:run.endedAt||'',remoteId:run.remoteId||'',remote:copy(run.remote||null),cancelRequestedAt:run.cancelRequestedAt||'',archivedAt:now(),resolutionBasis:receipt.basis};
  run.unresolvedHistory=[...(run.unresolvedHistory||[]),unresolved];
  item.unresolvedHistory=[...(item.unresolvedHistory||[]),{status:item.status,error:item.error||'',message:item.message||'',endedAt:item.endedAt||'',remoteId:item.remoteId||'',archivedAt:now()}];
  item.status='cancelled';item.message='用户已核对原远程任务终止，保留人工回执';item.terminationReceipt=copy(receipt);item.endedAt=now();
  delete item.error;
  run.status='cancelled';run.terminationReceipt=copy(receipt);run.endedAt=now();run.error='用户已核对远程任务终止；该结论来自人工回执，不是服务自动查询';batch.status=this.settledStatus(batch);batch.endedAt=now();
  try{this.save(batch);}catch(error){for(const key of Object.keys(batch))delete batch[key];Object.assign(batch,beforeBatch);for(const key of Object.keys(run))delete run[key];Object.assign(run,beforeRun);throw error;}
  return copy(batch);
 }
 start({id,links}){
  this.assertAvailable(id);
  const items=linkItems(links);this.assertSourcesAvailable(items.map(item=>item.url));
  const batch={id:crypto.randomUUID(),draftId:id,status:'queued',createdAt:now(),items,protocol:extractionMode(this.service.providers.config()),applications:[]};
  const before=this.store.data.extractionBatches;
  this.store.data.extractionBatches=[batch,...(before||[])];
  try{this.save(batch);}catch(error){if(before===undefined)delete this.store.data.extractionBatches;else this.store.data.extractionBatches=before;throw error;}
  const control={cancelled:false,runId:''};this.active.set(batch.id,control);
  // 批次先落盘并返回，UI 可立即显示队列，后续执行不阻塞其他 IPC。
  setImmediate(()=>this.drive(batch,control).catch(error=>{batch.status=batch.items.some(row=>row.status==='unknown')?'unknown':'failed';batch.error=error.message;batch.endedAt=now();for(const item of batch.items)if(item.status==='queued'){item.status='cancelled';item.message='批次异常，未发起提取';}try{this.save(batch);}catch{}finally{this.active.delete(batch.id);}}));
  return copy(batch);
 }
 output(item,result){
  if(result?.stale)throw Error('提取结果已过期，未接受该文案');
  if(typeof result?.text!=='string'||!result.text.trim())throw Error('提取服务没有返回有效文案');
  item.text=result.text;item.sourceAssetId=result.sourceAssetId||result.linkSource?.assetId||'';
  if(result.linkSource)item.linkSource=copy(result.linkSource);
  if(result.evidence)item.evidence=copy(result.evidence);
  item.output=copy(result);
 }
 async drive(batch,control){
  try{
   if(!control.cancelled){batch.status='running';batch.startedAt=now();this.save(batch);}
   for(const item of batch.items){
    if(control.cancelled)break;
    if(item.status!=='queued')continue;
    item.status='running';item.startedAt=now();item.message='正在静默提取';this.save(batch);
    try{
     const result=await this.service.runtime.run('extract',batch.draftId,{batchId:batch.id,itemId:item.id,sourceUrl:item.url,originalShareText:item.originalShareText,protocol:batch.protocol},async ctx=>{
      const run=this.store.data.runs.find(row=>row.type==='extract'&&row.parameters?.batchId===batch.id&&row.parameters?.itemId===item.id&&row.status==='running');
      if(!run)throw Error('提取运行记录丢失，未提交');
      item.runId=run.id;control.runId=run.id;this.save(batch);
      if(control.cancelled){this.service.runtime.cancel(run.id);ctx.signal.throwIfAborted();}
      try{
       const result=await this.service.extractReferenceSource({id:batch.draftId,sourceUrl:item.originalShareText},{...ctx,onReferenceAsset:(assetId,sha256)=>{item.sourceAssetId=assetId;item.assetSha256=sha256;ctx.local({kind:'batch-extract-source-v1',assetId,sha256});this.save(batch);},progress:(value,message)=>{ctx.progress(value,message);if(ctx.signal.aborted)return;item.progress=Math.max(0,Math.min(99,Number(value)||0));item.message=String(message||item.message);this.save(batch);}});
       if(result?.stale)throw Error('提取结果已过期，未接受该文案');
       if(typeof result?.text!=='string'||!result.text.trim())throw Error('提取服务没有返回有效文案');
       return result;
      }catch(error){
       // 服务桥提交后断网或停止等待不能证明远端未接单，保留未知状态防止重复提交。
       if(batch.protocol==='bridge'&&/无法连接模型服务|模型服务请求超时|请求已停止/.test(error.message))error.unknown=true;
       throw error;
      }
     });
     this.output(item,result);item.status='succeeded';item.progress=100;item.message='提取完成，等待选用';
    }catch(error){
     const run=this.store.data.runs.find(row=>row.id===item.runId);
     item.status=error.unknown||run?.status==='unknown'||run?.remoteId?'unknown':control.cancelled||run?.status==='cancelled'?'cancelled':'failed';
     item.error=error.message;item.message=item.status==='unknown'?'远程结果待确认，未继续提交':item.status==='cancelled'?'已停止当前提取':'本条提取失败';
     if(run?.remoteId)item.remoteId=run.remoteId;
     if(run?.remote)item.remote=copy(run.remote);
     if(item.status==='unknown'||item.status==='cancelled')control.cancelled=true;
    }finally{item.endedAt=now();control.runId='';this.save(batch);}
   }
   for(const item of batch.items)if(item.status==='queued'){item.status='cancelled';item.message=batch.items.some(row=>row.status==='unknown')?'原远程结果待确认，未发起提取':'已停止，未发起提取';item.endedAt=now();}
   const unknown=batch.items.some(row=>row.status==='unknown'),failed=batch.items.some(row=>row.status==='failed'),succeeded=batch.items.some(row=>row.status==='succeeded');
   batch.status=unknown?'unknown':control.cancelled?'cancelled':failed?(succeeded?'partial':'failed'):'succeeded';batch.endedAt=now();this.save(batch);
  }finally{this.active.delete(batch.id);}
 }
 cancel({id,batchId}){
  const batch=this.batch(id,batchId),control=this.active.get(batch.id);
  if(!control)return copy(batch);
  control.cancelled=true;batch.status='stopping';batch.cancelRequestedAt=now();
  for(const item of batch.items)if(item.status==='queued'){item.status='cancelled';item.message='已停止，未发起提取';item.endedAt=now();}
  try{this.save(batch);}finally{if(control.runId&&this.service.runtime.controllers.has(control.runId))this.service.runtime.cancel(control.runId);}
  return copy(batch);
 }
 use({id,batchId,itemId,expectedDraft}){
  this.reconcile({id,batchId});
  const batch=this.batch(id,batchId),item=batch.items.find(row=>row.id===itemId);
  if(!item||item.status!=='succeeded'||!item.text.trim())throw Error('请选择已成功提取的文案');
  const sourceRun=this.store.data.runs.find(run=>run.id===item.runId&&run.draftId===id&&run.type==='extract');
  if(item.output?.stale||item.stale||sourceRun?.output?.stale)throw Error('提取结果已过期，请重新核对来源');
  if(pending.includes(batch.status))throw Error('请等待批次结束或停止后再选用文案');
  const draft=this.store.draft(id);
  if(!expectedDraft||typeof expectedDraft!=='object'||Array.isArray(expectedDraft)||copyFields.some(key=>!Object.hasOwn(expectedDraft,key)||expectedDraft[key]!==draft[key]))throw Error('当前原稿、改写、确认稿或来源已变化，请刷新核对后再选用');
  if(require('./workflow-state.cjs').workflowActive(this.store.data,id))throw Error('自动流程正在执行，请先停止后选用');
  if(this.store.data.runs.some(run=>run.draftId===id&&run.parameters?.batchId!==batchId&&['extract','reference-analysis','reference-script'].includes(run.type)&&['running','queued','unknown'].includes(run.status)))throw Error('该任务正在解析或远程结果待确认，请先处理原任务再选用');
  if(item.sourceAssetId){const asset=this.store.asset(item.sourceAssetId);if(item.linkSource?.sha256&&crypto.createHash('sha256').update(fs.readFileSync(asset.path)).digest('hex')!==item.linkSource.sha256)throw Error('来源素材已变化，未替换当前原稿');}
  const previous=copy(draft),next=copy(draft);next.sourceUrl=item.originalShareText||item.url;next.sourceText=item.text;next.rewrite='';next.finalText='';next.confirmed=false;next.step=1;
  next.artifacts??={};next.artifacts.extractSelection={batchId,itemId,runId:item.runId,url:item.url,sourceAssetId:item.sourceAssetId||'',selectedAt:now()};
  const before=batch.applications;batch.applications=[...(before||[]),{itemId,selectedAt:now(),previous:{sourceUrl:previous.sourceUrl,sourceText:previous.sourceText,rewrite:previous.rewrite,finalText:previous.finalText,confirmed:previous.confirmed}}];
  try{return this.store.updateDraft(next,{preserveCurrentId:true});}catch(error){batch.applications=before;throw error;}
 }
 assetInUse(assetId){return this.batches().some(batch=>this.store.data.drafts.some(draft=>draft.id===batch.draftId)&&batch.items.some(item=>item.sourceAssetId===assetId||item.linkSource?.assetId===assetId));}
}
module.exports={BatchLinkExtraction,linkItems,summarize,draftSnapshot};
