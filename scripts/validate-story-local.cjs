// 仅在独立验收工作区调用真实本地模型；失败和未知不伪造、不自动重交。
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {setTimeout:sleep}=require('node:timers/promises');
const {createService}=require('../server/service.cjs');
const {createStory}=require('../server/story-contract.cjs');
const project=path.resolve(__dirname,'..'),evidence=path.join(project,'evidence/validation/story-local-20261116'),workspace=path.join(evidence,'workspace');
const stateFile=path.join(evidence,'validation-state.json');
fs.mkdirSync(evidence,{recursive:true});
const state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8').replace(/^\uFEFF/,'')):{version:1,startedAt:new Date().toISOString(),steps:{}};
if(state.error){state.attempts=[...(state.attempts||[]),{endedAt:state.error.at,error:state.error,stage:state.inFlight?.name||'preflight'}];delete state.error;}
const save=()=>fs.writeFileSync(stateFile,JSON.stringify(state,null,2));
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const note=(stage,details={})=>{const row={at:new Date().toISOString(),stage,...details};fs.appendFileSync(path.join(evidence,'events.jsonl'),JSON.stringify(row)+'\n');console.log(JSON.stringify(row));};
async function idle(){for(;;){const daily=JSON.parse(fs.readFileSync(path.join(project,'workspaces/local-studio/studio.json'),'utf8')),active=daily.runs.filter(run=>['running','queued'].includes(run.status)&&['avatar','speech','speech-test','voice-design','story-image','story-video'].includes(run.type));const queue=await (await fetch('http://127.0.0.1:8188/queue',{signal:AbortSignal.timeout(10000)})).json();if(!active.length&&!queue.queue_running?.length&&!queue.queue_pending?.length)return;note('waiting-other-local-model-task',{dailyActive:active.map(run=>({id:run.id,type:run.type})),comfyRunning:queue.queue_running?.length,comfyPending:queue.queue_pending?.length});await sleep(20000);}}
async function main(){
 const daily=JSON.parse(fs.readFileSync(path.join(project,'workspaces/local-studio/studio.json'),'utf8'));
 const service=createService(workspace);let lastRunState='';
 const monitor=setInterval(()=>{const run=service.store.data.runs.find(row=>row.status==='running');if(!run)return;const signature=JSON.stringify([run.id,run.progress,run.activity]);if(lastRunState!==signature){lastRunState=signature;note('run-progress',{id:run.id,type:run.type,progress:run.progress,activity:run.activity});}},5000);
 monitor.unref();
 try{
  const unresolved=service.store.data.runs.filter(run=>['unknown','interrupted','failed'].includes(run.status)&&!state.reviewedRunIds?.includes(run.id));
  if(unresolved.length){state.unresolved=unresolved.map(({id,type,status,error,remoteId})=>({id,type,status,error,remoteId}));save();throw Error('验收工作区存在未处理任务，先核查原失败或未知记录，不自动重交');}
  if(!state.configured){
   const permitted=['textProtocol','baseUrl','model','textMaxTokens','textContextTokens'];const provider={};for(const key of permitted)if(typeof daily.settings.provider[key]==='string')provider[key]=daily.settings.provider[key];
   if(provider.textProtocol!=='ollama'||!/^http:\/\/(127\.0\.0\.1|localhost):/.test(provider.baseUrl||''))throw Error('隔离验收仅允许已有本地Ollama文本服务');
   provider.storyImageProtocol='comfy';provider.storyImageBaseUrl='http://127.0.0.1:8188';provider.storyImageModel='sd_xl_base_1.0.safetensors';provider.storyVideoProtocol='comfy-h3';provider.storyVideoBaseUrl='http://127.0.0.1:8188';provider.storyVideoModel='minimax_h3_fl2va_pruned_int8_convrot.safetensors';
   await service.invoke('saveSettings',{outputDir:path.join(workspace,'outputs'),ffmpegPath:daily.settings.ffmpegPath||'F:/Software/轻语IP智能体/aigc-human/resources/ffmpeg/bin/ffmpeg.exe',ffprobePath:daily.settings.ffprobePath||'F:/Software/轻语IP智能体/aigc-human/resources/ffmpeg/bin/ffprobe.exe',provider});
   await service.invoke('saveStoryModels',{provider});state.configured=true;state.provider=provider;save();
  }
  if(!state.draftId){const draft=await service.invoke('newDraft');state.draftId=draft.id;save();}
  const id=state.draftId;
  async function stage(name,action,payload,{model=false}={}){if(state.steps[name]){note('reuse-completed-stage',{name});return state.steps[name].result;}if(model)await idle();note('begin',{name,action});state.inFlight={name,action,payload,startedAt:new Date().toISOString()};save();const result=await service.invoke(action,payload);if(result?.stale)throw Error(name+'返回过期候选，未继续');const file=path.join(evidence,name+'.json');fs.writeFileSync(file,JSON.stringify(result,null,2));state.steps[name]={completedAt:new Date().toISOString(),file,result};delete state.inFlight;save();note('complete',{name,materialId:result?.material?.id});return result;}
  if(!state.steps.setup){let draft=structuredClone(service.store.draft(id));draft.title='非口播真实链路验收·两集风中纸船';draft.sourceText='清晨，一只红色纸船沿着浅水溪流缓缓向前漂。\n微风吹过，红色纸船绕过石头，继续漂向阳光照亮的溪面。';draft.rewrite=draft.sourceText;draft.finalText=draft.sourceText;draft.confirmed=true;draft.video.mode='story';await service.invoke('saveDraft',draft);let story=createStory(service.store.draft(id));Object.assign(story,{episodeCount:2,episodeDuration:4,aspect:'16:9',style:'Live-action macro photography, natural morning sunlight, realistic paper texture and flowing water.',instructions:'原文是虚构视觉练习，没有人物，无对白，无画面字幕。每集只拆一个4秒连续镜头；同一红色纸船保持外观一致。'});await stage('setup','saveStory',{id,story,revision:0});}
  if(!state.steps.confirmed){const {confirmationInput}=await import('../server/copy-confirmation.mjs');await stage('confirmed','confirmCopy',{id,input:confirmationInput(service.store.draft(id))});}
  await stage('models','checkStoryModels',{});
  await stage('episodes','splitStoryEpisodes',{id});assert.equal(service.stories.story(id).episodes.length,2);
  const episodeId=service.stories.story(id).episodes[0].id;state.episodeId=episodeId;save();
  await stage('shots','splitStoryShots',{id,episodeId});assert.equal(service.stories.story(id).episodes[0].shots.length,1);
  await stage('assets','extractStoryAssets',{id,episodeId});
  const first=service.stories.story(id).episodes[0].shots[0];assert(first.assetIds.length>0,'实际模型没有提取可用资产，不能假造引用');state.shotId=first.id;save();
  for(const assetId of first.assetIds){await stage('asset-image-'+assetId,'generateStoryImage',{id,assetId},{model:true});const a=service.stories.story(id).assets.find(row=>row.id===assetId),imageId=a.images.at(-1).id;await stage('asset-select-'+assetId,'selectStoryImage',{id,assetId,imageId});}
  const assetId=first.assetIds[0],original=service.stories.story(id).assets.find(row=>row.id===assetId).selectedImageId;
  const redo=await stage('asset-redo','generateStoryImage',{id,assetId,instruction:'Preserve the same subject and material. Use softer natural morning illumination and show crisp realistic surface details without text or watermark.'},{model:true});
  const afterRedo=service.stories.story(id).assets.find(row=>row.id===assetId);assert.equal(afterRedo.selectedImageId,original,'重做不能自动替换已选版本');assert(afterRedo.images.length>=2);assert.notEqual(redo.material.id,original);state.assetCandidatePreserved=true;save();
  if(!state.steps['primary-reference-correction']){
   const current=service.stories.story(id),shot=current.episodes[0].shots[0],paper=current.assets.find(asset=>asset.name.includes('纸船')),stream=current.assets.find(asset=>asset.name==='清澈溪流');
   if(!paper)throw Error('未找到明确的纸船主资产，不能猜测主参考');
   const before={assetIds:[...shot.assetIds],primaryReferenceAssetId:shot.primaryReferenceAssetId||'',assetKinds:current.assets.map(asset=>({id:asset.id,kind:asset.kind,name:asset.name}))};
   paper.kind='prop';shot.assetIds=[paper.id,...(stream?[stream.id]:[])];shot.primaryReferenceAssetId=paper.id;
   state.manualCorrection={reason:'真实模型将纸船误分类为character，并将光线/机位拆为scene；人工按原文修正，不代表原模型分类通过',before,after:{assetIds:[...shot.assetIds],primaryReferenceAssetId:paper.id,paperKind:paper.kind},at:new Date().toISOString()};save();
   await stage('primary-reference-correction','saveStory',{id,story:current,revision:current.revision});
  }
  const paper=service.stories.story(id).assets.find(asset=>asset.name.includes('纸船'));
  if(paper&&!paper.selectedImageId){const prior=state.steps['asset-image-'+paper.id]?.result?.material;if(!prior?.path)throw Error('人工修正分类后缺少可复用的原图，不猜测资产');const imported=await stage('manual-reuse-paper-image','importFile',{name:'人工复用-已审纸船.png',base64:fs.readFileSync(prior.path).toString('base64')});await service.invoke('selectStoryImage',{id,assetId:paper.id,imageId:imported.id});state.manualCorrection.reusedImage={originalId:prior.id,reimportedId:imported.id,reason:'资产分类变化导致旧候选失效，人工确认继续复用已审图片，非新模型生成'};save();}
  await stage('shot-image-primary','generateStoryImage',{id,episodeId,shotId:first.id},{model:true});const shotImage=service.stories.story(id).episodes[0].shots[0].images.at(-1).id;
  if(state.approvedShotImageId!==shotImage){state.status='awaiting-root-shot-image-review';state.reviewCandidate={id:shotImage,path:service.store.asset(shotImage).path,requestedAt:new Date().toISOString()};save();note('review-required',state.reviewCandidate);return;}
  await stage('shot-select-image-primary','selectStoryImage',{id,episodeId,shotId:first.id,imageId:shotImage});
  await stage('shot-video-primary','generateStoryVideo',{id,episodeId,shotId:first.id},{model:true});const videoId=service.stories.story(id).episodes[0].shots[0].videos.at(-1).id;
  await stage('shot-select-video-primary','selectStoryVideo',{id,episodeId,shotId:first.id,videoId});
  await stage('compose','composeStoryEpisode',{id,episodeId});const handoff=await stage('handoff','useStoryEpisode',{id,episodeId});const final=service.store.draft(id);assert.equal(final.step,4);assert.equal(final.edit.sourceId,handoff.assetId);assert.equal(final.video.assetId,handoff.assetId);assert.equal(final.finalText,final.sourceText);assert.equal(final.story.episodes.length,2);
  const outputs=service.store.data.assets.map(asset=>({id:asset.id,type:asset.type,path:asset.path,sha256:digest(asset.path),duration:asset.duration,width:asset.width,height:asset.height,storyGeneration:asset.storyGeneration}));fs.writeFileSync(path.join(evidence,'outputs.json'),JSON.stringify(outputs,null,2));
  const finalAsset=service.store.asset(handoff.assetId);fs.copyFileSync(finalAsset.path,path.join(evidence,'非口播-纸船-第一集-4秒.mp4'));state.status='technical-complete-content-review-pending';state.finishedAt=new Date().toISOString();state.handoff={draftId:id,episodeId,videoId:handoff.assetId,step:final.step};save();note('technical-complete',{output:path.join(evidence,'非口播-纸船-第一集-4秒.mp4'),qualityAccepted:false});
 }finally{clearInterval(monitor);}
}
main().catch(error=>{state.error={message:error.message,stack:error.stack,at:new Date().toISOString()};save();note('failed',{error:error.message});process.exitCode=1;});
