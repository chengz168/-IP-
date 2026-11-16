// 发布使用独立生命周期；超时或停止不能证明平台没有完成提交。
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function content(d){return{videoId:d.publish.videoId||d.edit.resultId||d.video.assetId,coverId:d.publish.coverId||d.cover.assetId||'',title:d.publish.title,description:d.publish.description,tags:d.publish.tags,accountIds:d.publish.accountIds,mode:d.publish.mode,autoCloseBrowser:d.publish.mode==='direct'&&d.publish.autoCloseBrowser===true};}
const signature=d=>crypto.createHash('sha256').update(JSON.stringify(content(d))).digest('hex');
const identity=a=>JSON.stringify([a.id,a.name,a.platform,a.displayName]);
function hashFile(file){const digest=crypto.createHash('sha256'),buffer=Buffer.alloc(1024*1024),fd=fs.openSync(file,'r');try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size<=0)throw Error('发布文件为空或无效');let count;while((count=fs.readSync(fd,buffer,0,buffer.length,null)))digest.update(buffer.subarray(0,count));return digest.digest('hex');}finally{fs.closeSync(fd);}}
function combinedDescription(description,tags){if(typeof description!=='string'||!Array.isArray(tags)||tags.some(t=>typeof t!=='string'))throw Error('发布描述或标签格式无效');return[description.trim(),tags.map(t=>t.trim()).filter(Boolean).map(t=>t.startsWith('#')?t:'#'+t).join(' ')].filter(Boolean).join('\n');}
function validEvidence(result,mode,submittedAt){const e=result?.evidence;let u;try{u=new URL(e?.url);}catch{return false;}const words=mode==='draft'?['保存草稿成功','草稿保存成功','已保存草稿','已存为草稿']:['发布成功','作品发布成功'];return result.status===(mode==='draft'?'draft_saved':'published')&&e.kind==='fresh-platform-success-message'&&e.mode===mode&&u.protocol==='https:'&&u.hostname==='creator.douyin.com'&&Number.isFinite(Date.parse(e.observedAt))&&Date.parse(e.observedAt)>=Date.parse(submittedAt)&&words.some(w=>e.text===w||e.text?.startsWith(w+'，')||e.text?.startsWith(w+'！')||e.text?.startsWith(w+'!'));}
function recoverPublish(run){if(run.type!=='publish'||!['running','queued'].includes(run.status))return;const touched=run.accounts?.some(a=>['upload_started','submitting','confirmed'].includes(a.stage));run.status=touched?'unknown':'interrupted';run.error=touched?'程序在发布期间退出，平台可能已收到文件或提交；请核对原任务，未自动重交。':'程序在上传前退出，未自动重跑发布。';run.endedAt=new Date().toISOString();for(const a of run.accounts||[])if(['queued','running'].includes(a.status)){a.status=['upload_started','submitting'].includes(a.stage)?'unknown':'interrupted';a.error=run.error;}}
class PublishJobs{
 constructor(store,accounts,browser){this.store=store;this.accounts=accounts;this.browser=browser;this.reviews=new Map();this.controllers=new Map();this.tasks=new Map();}
 blocked(draftId,ids){return this.store.data.runs.find(r=>r.type==='publish'&&['running','queued','unknown'].includes(r.status)&&(r.draftId===draftId||r.accounts?.some(a=>ids.includes(a.id)&&['queued','running','unknown'].includes(a.status))));}
 async review(id){
  if(typeof this.browser?.publish!=='function')throw Error('请在桌面工作台使用平台发布');
  const checked=await this.accounts.prepare(id),draft=this.store.draft(id),input=structuredClone(content(draft));
  if(this.blocked(id,input.accountIds))throw Error('已有发布任务运行中或结果待确认，请先核对原任务');
  const description=combinedDescription(input.description,input.tags),files={};for(const [kind,assetId]of [['video',input.videoId],['cover',input.coverId]])if(assetId){const asset=this.store.asset(assetId);files[kind]={id:asset.id,path:asset.path,sha256:hashFile(asset.path)};}
  const reviewId=crypto.randomUUID(),at=Date.now(),snapshot={draftId:id,input,signature:signature(draft),description,files,accounts:input.accountIds.map(accountId=>({id:accountId,identity:identity(this.accounts.account(accountId)),generation:this.accounts.generations.get(accountId)||0})),expiresAt:at+600000};
  for(const [key,value]of this.reviews)if(value.expiresAt<at)this.reviews.delete(key);this.reviews.set(reviewId,snapshot);
  return{...checked,reviewId,expiresAt:new Date(snapshot.expiresAt).toISOString(),autoCloseBrowser:input.autoCloseBrowser,combinedDescription:description,uploadEnabled:true,message:input.mode==='draft'?'确认后将视频、封面和文案上传至所选账号并保存平台草稿。':'确认后将视频、封面和文案上传至所选账号并直接发布。'};
 }
 assertCurrent(snapshot,{files=false,accountId}={}){
  if(signature(this.store.draft(snapshot.draftId))!==snapshot.signature)throw Error('发布内容已变化，请重新检查并确认');
  for(const a of snapshot.accounts.filter(a=>!accountId||a.id===accountId))if(identity(this.accounts.account(a.id))!==a.identity||(this.accounts.generations.get(a.id)||0)!==a.generation)throw Error('发布账号或登录窗口已变化，请重新检查');
  if(files)for(const file of Object.values(snapshot.files))if(this.store.asset(file.id).path!==file.path||hashFile(file.path)!==file.sha256)throw Error('发布素材文件已变化，请重新检查');
 }
 start({id,reviewId}){
  const snapshot=this.reviews.get(reviewId);if(!snapshot||snapshot.draftId!==id||Date.now()>snapshot.expiresAt)throw Error('发布确认已失效，请重新检查');
  if(this.blocked(id,snapshot.input.accountIds))throw Error('已有发布任务运行中或结果待确认，请先核对原任务');this.assertCurrent(snapshot,{files:true});
  const run={id:crypto.randomUUID(),type:'publish',draftId:id,status:'running',progress:0,createdAt:new Date().toISOString(),parameters:{mode:snapshot.input.mode,autoCloseBrowser:snapshot.input.autoCloseBrowser},snapshot:structuredClone(snapshot),logs:[],accounts:snapshot.accounts.map(a=>({id:a.id,name:this.accounts.account(a.id).name,platform:this.accounts.account(a.id).platform,status:'queued',stage:'queued'}))};
  this.store.data.runs.unshift(run);try{this.store.save();}catch(error){this.store.data.runs=this.store.data.runs.filter(r=>r!==run);throw error;}
  this.reviews.delete(reviewId);const controller=new AbortController();this.controllers.set(run.id,controller);
  const task=Promise.resolve().then(()=>this.execute(run,controller.signal));this.tasks.set(run.id,task);task.finally(()=>{this.controllers.delete(run.id);this.tasks.delete(run.id);}).catch(()=>{});return structuredClone(run);
 }
 checkpoint(run,mutate){const before=structuredClone(run);try{mutate();this.store.save();}catch(error){for(const key of Object.keys(run))delete run[key];Object.assign(run,before);throw error;}}
 async execute(run,signal){
  const snapshot=run.snapshot,dir=path.join(this.store.root,'publish-runs',run.id);let copies;
  try{
   this.assertCurrent(snapshot,{files:true});fs.mkdirSync(dir,{recursive:true});copies={};
   for(const [kind,file]of Object.entries(snapshot.files)){const target=path.join(dir,kind+path.extname(file.path));fs.copyFileSync(file.path,target,fs.constants.COPYFILE_EXCL);if(hashFile(target)!==file.sha256||hashFile(file.path)!==file.sha256)throw Error('发布素材复制期间已变化，未上传');copies[kind]=target;}
   for(let i=0;i<run.accounts.length;i++){
    if(signal.aborted)break;let row=run.accounts[i];
    try{
     this.assertCurrent(snapshot,{accountId:row.id});const checked=await this.accounts.check(row.id);if(checked.connection.status!=='connected')throw Error(checked.connection.message);this.assertCurrent(snapshot,{accountId:row.id});
     this.checkpoint(run,()=>{row.status='running';row.stage='preparing';row.startedAt=new Date().toISOString();run.message='正在处理 '+row.name;});
     const progress=message=>this.checkpoint(run,()=>{row.message=message;run.message=row.name+'：'+message;run.logs.push({at:new Date().toISOString(),message:run.message});run.progress=Math.round((i+.3)/run.accounts.length*100);});
     const result=await this.browser.publish(row.id,{videoPath:copies.video,coverPath:copies.cover||'',title:snapshot.input.title,description:snapshot.description,mode:snapshot.input.mode},{signal,progress,
      beforeUpload:async()=>{this.assertCurrent(snapshot,{accountId:row.id});if(signal.aborted)throw Error('已请求停止发布');if(hashFile(copies.video)!==snapshot.files.video.sha256||(copies.cover&&hashFile(copies.cover)!==snapshot.files.cover.sha256))throw Error('发布快照文件已变化');this.checkpoint(run,()=>{row.stage='upload_started';row.uploadStartedAt=new Date().toISOString();});},
      beforeCommit:async()=>{this.assertCurrent(snapshot,{accountId:row.id});if(signal.aborted)throw Error('已请求停止发布');if(row.stage!=='upload_started')throw Error('发布上传边界缺失，未提交');this.checkpoint(run,()=>{row.stage='submitting';row.submittedAt=new Date().toISOString();});}
     });
     if(row.stage!=='submitting'||!validEvidence(result,snapshot.input.mode,row.submittedAt))throw Error('没有取得与本次发布方式对应的平台成功凭据');
     this.checkpoint(run,()=>{row.status='succeeded';row.stage='confirmed';row.result=result;row.endedAt=new Date().toISOString();run.progress=Math.round((i+1)/run.accounts.length*100);});
     if(snapshot.input.autoCloseBrowser){try{this.accounts.close(row.id);}catch(error){this.checkpoint(run,()=>{row.warning='平台已确认成功，关闭窗口失败：'+error.message;});}}
    }catch(error){
     // 写盘失败会回滚整个run，需要重新取得权威行引用。
     row=run.accounts[i];if(row.stage==='confirmed'){row.warning='平台已确认成功，后续处理异常：'+error.message;continue;}const touched=['upload_started','submitting'].includes(row.stage);this.checkpoint(run,()=>{row.status=touched?'unknown':signal.aborted?'cancelled':'failed';row.error=error.message;row.endedAt=new Date().toISOString();});if(touched||signal.aborted)break;
    }
   }
  }catch(error){run.error=error.message;}
  finally{
   for(const row of run.accounts)if(['queued','running'].includes(row.status)){row.status=['upload_started','submitting'].includes(row.stage)?'unknown':signal.aborted?'cancelled':'failed';row.error=run.error||'本轮未继续处理此账号';row.endedAt=new Date().toISOString();}
   const successes=run.accounts.filter(a=>a.status==='succeeded').length,unknown=run.accounts.some(a=>a.status==='unknown');run.status=unknown?'unknown':successes===run.accounts.length?'succeeded':signal.aborted?'cancelled':'failed';run.partial=successes>0&&successes<run.accounts.length;run.endedAt=new Date().toISOString();if(run.status==='succeeded')run.progress=100;
   run.message=unknown?'平台结果待确认，请核对原任务，勿重复提交':run.partial?'部分账号成功，请逐账号核对结果':run.status==='succeeded'?(snapshot.input.mode==='draft'?'平台草稿已确认保存':'平台已确认发布'):run.status==='cancelled'?'已停止后续发布，请核对账号记录':'发布失败，请查看账号详情';
   const record={id:crypto.randomUUID(),runId:run.id,draftId:run.draftId,signature:snapshot.signature,status:run.status==='succeeded'?(snapshot.input.mode==='draft'?'draft_saved':'published'):unknown?'unknown':run.partial?'partial':run.status,title:snapshot.input.title,mode:snapshot.input.mode,createdAt:run.endedAt,accounts:structuredClone(run.accounts)};
   const priorDraft=this.store.draft(run.draftId),before=structuredClone(priorDraft);this.store.data.publishRecords.unshift(record);run.recordId=record.id;
   if(run.status==='succeeded'&&signature(priorDraft)===snapshot.signature)priorDraft.publish.recordId=record.id;
   try{this.store.save();}catch(error){this.store.data.publishRecords=this.store.data.publishRecords.filter(r=>r!==record);Object.assign(priorDraft,before);run.status='unknown';run.error='发布结果写盘失败，需核对平台后恢复：'+error.message;run.message=run.error;}
  }
  return structuredClone(run);
 }
 cancel(id){const controller=this.controllers.get(id),run=this.store.data.runs.find(r=>r.id===id&&r.type==='publish');if(!controller||!run)throw Error('发布任务已结束或待人工确认，未再次提交');this.checkpoint(run,()=>{run.stopRequestedAt=new Date().toISOString();run.message='已请求停止后续操作，平台已收到的文件或提交仍需核对';});controller.abort();return true;}
 status(id){const run=this.store.data.runs.find(r=>r.id===id&&r.type==='publish');if(!run)throw Error('发布任务不存在');return structuredClone(run);}
}
module.exports={PublishJobs,content,signature,combinedDescription,hashFile,validEvidence,recoverPublish};
