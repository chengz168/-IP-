const crypto=require('node:crypto');
const fs=require('node:fs');
const {capabilityBaseUrl}=require('./provider-endpoints.mjs');
const {workflowActive,workflowInput}=require('./workflow-state.cjs');
const {activeStoryEpisode,downstreamDraft}=require('./story-links.cjs');
const names={speech:'声音生成',avatar:'数字人视频',transcribe:'识别字幕',render:'剪辑视频',title:'封面标题',frame:'封面背景',cover:'封面图片',metadata:'发布信息',publish:'视频发布'};
const stamp=()=>new Date().toISOString();

// 主进程串行调度。每次重试创建新快照，停止或重启后不会擅自重交远程任务。
class WorkflowJobs{
 constructor(service){this.service=service;this.store=service.store;this.controllers=new Map();this.childRuns=new Map();this.pumping=false;}
 available(id,type){try{const a=this.store.asset(id);return a.type===type&&fs.statSync(a.path).size>0;}catch{return false;}}
 plan(id){
  const d=this.store.draft(id),p=this.store.data.settings.provider,stages=[],issues=[];
  const route=require('./video-routing.cjs').effectiveVideoRoute(d);
  if(route.policy==='auto'&&['story','product'].includes(route.mode)&&!this.available(d.edit.sourceId||d.video.assetId,'video'))return {draftId:id,stages,issues:[`当前文案自动选择${route.mode==='story'?'非口播分镜创作':'商品宣传'}，请进入第四步完成镜头并选用成片，再执行后续剪辑。判断依据：${route.reason}`]};
  if(d.video.mode==='story'&&!this.available(d.edit.sourceId||d.video.assetId,'video'))issues.push('请先在第四步非口播创作中完成当前集并选用，再自动执行剪辑、封面与发布信息');
  if(d.video.mode==='product'&&(!d.productSelection||d.productSelection.baseId!==(d.edit.sourceId||d.video.assetId)||!this.available(d.edit.sourceId||d.video.assetId,'video')))return {draftId:id,stages,issues:['请先在第四步商品宣传中生成并选用商品视频，再自动执行剪辑、封面与发布信息']};
  const add=(key,action,reason='')=>stages.push({key,name:names[key],action,reason,status:'pending',runId:'',assetId:'',error:''});
  if(!activeStoryEpisode(d)&&(!d.confirmed||!d.finalText.trim()))issues.push('请先确认最终文案');
  const editAsset=this.store.data.assets.find(a=>a.id===d.edit.resultId),hasEdit=this.available(d.edit.resultId,'video')&&require('./title-output.mjs').titleOutputCurrent(d,editAsset)&&require('./subtitle-output.mjs').subtitleOutputCurrent(d,editAsset)&&require('./pip-matching.cjs').pipResultCurrent(this.store.data,d,editAsset),imported=!!d.edit.sourceId,videoId=d.edit.sourceId||d.video.assetId||d.edit.resultId,hasVideo=this.available(videoId,'video');
  if(imported&&!hasVideo)issues.push('手选剪辑视频不存在或不是有效视频，请重新选择');
  if(hasVideo){add('speech',this.available(d.voice.audioId,'audio')?'reuse':'skip','已有视频源，不重新生成配音');add('avatar','reuse',imported?'使用明确手选的剪辑视频，不代表生成了数字人':'复用已有数字人视频');}
  else{
   const hasVoice=this.available(d.voice.audioId,'audio');add('speech',hasVoice?'reuse':'generate');add('avatar','generate');
   if(!hasVoice){if(p.ttsProtocol==='indextts-local'&&(!p.indexttsHome||!this.store.data.voices.some(v=>v.id===d.voice.profile&&v.sampleId)))issues.push('请配置本地 IndexTTS 环境并选择参考声音样本');if(!['windows','indextts-local'].includes(p.ttsProtocol)&&(!capabilityBaseUrl(p,'tts')||!(d.voice.model==='classic'?(p.ttsClassicModel||p.ttsModel):(p.ttsFastModel||p.ttsModel))||(!p.voice&&!d.voice.profile)))issues.push('请配置实际语音服务和音色，或使用系统配音');if(p.ttsProtocol==='windows'&&d.voice.profile)issues.push('系统配音不支持克隆音色，请清空声音选择或配置实际克隆服务');}
   if(p.avatarProtocol==='musetalk-local'){
    if(!p.musetalkHome?.trim())issues.push('本地 MuseTalk 环境目录尚未配置');
   }else if(!p.avatarUrl)issues.push('数字人口型服务尚未配置；请接入实际服务，或明确导入已有视频作为剪辑源');
   if(d.video.mode==='multi'&&['musetalk-local','comfy-h3'].includes(p.avatarProtocol)){
    try{const shots=require('./video-shots.mjs').validateShots(d.video.shots,this.store.data.avatars);if(shots.some(shot=>!this.store.data.avatars.some(a=>a.id===shot.avatarId&&this.available(a.assetId,'video'))))issues.push('多镜头包含不可读取的形象视频，请重新选择');}catch(error){issues.push(error.message);}
   }else if(!this.store.data.avatars.some(a=>a.id===d.video.avatarId&&this.available(a.assetId,'video')))issues.push('请选择可读取的数字人形象视频');
  }
  const requiresCaptions=d.edit.subtitlesEnabled||(d.edit.pipEnabled&&d.edit.pipMode==='captions'&&!!d.edit.pipCategory);
  add('transcribe',hasEdit||!requiresCaptions?'skip':hasVideo&&d.edit.captions.length?'reuse':'generate',hasEdit?'已有剪辑结果':!requiresCaptions?'字幕已关闭且无需逐句匹配':!hasVideo?'新视频生成后重新识别字幕':'');
  if(!hasEdit&&requiresCaptions&&(!hasVideo||!d.edit.captions.length)){if(p.asrProtocol==='local-whisper'){if(!fs.existsSync(p.asrPythonPath||'')||!fs.existsSync(p.asrModelPath||''))issues.push('本地识别缺少已安装的Python或模型文件');}else if(!capabilityBaseUrl(p,'asr')||!p.asrModel)issues.push('请配置实际字幕识别服务，或先导入字幕');}
  add('render',hasEdit?'reuse':'generate');const coverSource=require('./cover-source.cjs'),hasTitle=!!d.cover.title.trim(),hasCover=this.available(d.cover.assetId,'image')&&coverSource.coverCurrent(this.store,d)&&!(coverSource.videoDerivedCover(this.store,d)&&!hasEdit),hasBackground=this.available(d.cover.backgroundId,'image')&&coverSource.backgroundCurrent(this.store,d)&&!(!hasEdit&&this.store.asset(d.cover.backgroundId).origin==='frame');add('title',hasTitle?'reuse':'generate');add('frame',hasCover&&hasTitle?'skip':hasBackground?'reuse':'generate',hasCover&&hasTitle?'复用已有封面，不重新抽帧':'');add('cover',hasCover&&hasTitle?'reuse':'generate');
  add('metadata',d.publish.title.trim()&&d.publish.description.trim()&&d.publish.tags.length?'reuse':'generate');add('publish','wait','真实平台发布尚未接入，素材准备后等待发布');
  if(stages.some(s=>['title','metadata'].includes(s.key)&&s.action==='generate')&&(!p.baseUrl||!p.model))issues.push('请配置实际文本模型以生成标题和发布信息');
  if(stages.some(s=>s.key==='cover'&&s.action==='generate')&&!this.service.renderCover)issues.push('当前环境没有后台封面绘制能力，请使用桌面工作台');
  if((this.store.data.runs||[]).some(r=>r.draftId===id&&['running','queued','unknown'].includes(r.status)))issues.push('该任务仍有运行中或远程结果待确认的执行，请先处理');
  return {draftId:id,stages,issues:[...new Set(issues)]};
 }
 enqueue(id,mode){
  if(!['auto','background'].includes(mode))throw new Error('执行模式必须为自动或后台');
  if(workflowActive(this.store.data,id))throw new Error('该任务已有自动流程，不能重复提交');
  const unknown=(this.store.data.workflowJobs||[]).find(j=>j.draftId===id&&j.status==='unknown');if(unknown)throw new Error('该任务的远程结果仍待确认，不能重复提交');
  const plan=this.plan(id);if(plan.issues.length)throw new Error(plan.issues.join('；'));
  const snapshot=structuredClone(this.store.draft(id)),job={id:crypto.randomUUID(),draftId:id,mode,status:'queued',phase:'排队中',progress:0,createdAt:stamp(),endedAt:'',error:'',input:snapshot,expectedInput:workflowInput(snapshot),settings:JSON.stringify(this.store.data.settings),stages:plan.stages,remoteId:''};
  const existed=!!this.store.data.workflowJobs;this.store.data.workflowJobs??=[];this.store.data.workflowJobs.unshift(job);try{this.store.save();}catch(error){this.store.data.workflowJobs=this.store.data.workflowJobs.filter(j=>j.id!==job.id);if(!existed)delete this.store.data.workflowJobs;throw error;}
  queueMicrotask(()=>this.pump());return structuredClone(job);
 }
 async pump(){if(this.pumping)return;this.pumping=true;try{let job;while(job=(this.store.data.workflowJobs||[]).slice().reverse().find(j=>j.status==='queued'))await this.execute(job);}finally{this.pumping=false;}}
 check(job,signal){if(signal.aborted)throw new Error('自动流程已停止');if(workflowInput(this.store.draft(job.draftId))!==job.expectedInput)throw new Error('任务输入已变化，自动流程已停止，未覆盖当前任务');if(JSON.stringify(this.store.data.settings)!==job.settings)throw new Error('执行配置已变化，请核对设置后重新启动自动流程');}
 commit(job,change){const next=structuredClone(this.store.draft(job.draftId));change(next);this.store.updateDraft(next,{workflowJobId:job.id});job.expectedInput=workflowInput(this.store.draft(job.draftId));this.store.save();}
 async operation(job,stage,type,work,signal,parameters={}){
  const pending=this.service.runtime.run(type,job.draftId,{...parameters,workflowJobId:job.id,stage:stage.key},work);const run=this.store.data.runs.find(r=>r.parameters?.workflowJobId===job.id&&r.parameters.stage===stage.key&&r.status==='running');if(run){stage.runId=run.id;this.childRuns.set(job.id,run.id);this.store.save();}
  const abort=()=>{const id=this.childRuns.get(job.id);if(id&&this.service.runtime.controllers.has(id))this.service.runtime.cancel(id);};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  try{return await pending;}catch(error){if(run?.status==='unknown'){error.unknown=true;job.remoteId=run.remoteId;}throw error;}finally{signal.removeEventListener('abort',abort);this.childRuns.delete(job.id);}
 }
 async execute(job){
  const controller=new AbortController(),signal=controller.signal;this.controllers.set(job.id,controller);job.status='running';job.startedAt=stamp();this.store.save();
  try{
   for(const stage of job.stages){this.check(job,signal);job.phase=stage.name;stage.startedAt=stamp();stage.status='running';this.store.save();
    const current=()=>structuredClone(this.store.draft(job.draftId));let output;
    if(stage.action==='wait'){require('./cover-source.cjs').assertCoverCurrent(this.store,current());this.commit(job,next=>{next.publish.videoId=next.edit.resultId||next.video.assetId;next.publish.coverId=next.cover.assetId;});stage.status='waiting';stage.reason='已生成真实媒体，等待平台发布集成及人工确认';job.status='awaiting_publish';job.phase='成片已就绪，等待发布';job.progress=100;job.endedAt=stamp();this.store.save();return;}
    if(stage.action==='skip'){stage.status='skipped';}
else if(stage.action==='reuse'){const d=current();if(stage.key==='cover')require('./cover-source.cjs').assertCoverCurrent(this.store,d);if(stage.key==='frame')require('./cover-source.cjs').coverInput(this.store,d);stage.assetId={speech:d.voice.audioId,avatar:d.edit.sourceId||d.video.assetId||d.edit.resultId,render:d.edit.resultId,frame:d.cover.backgroundId,cover:d.cover.assetId}[stage.key]||'';if(stage.assetId){const source=this.store.asset(stage.assetId),probe=await this.service.media.probe(source.path),expectedType={speech:'audio',avatar:'video',render:'video',frame:'image',cover:'image'}[stage.key],streamType=expectedType==='audio'?'audio':'video';if(source.type!==expectedType||!probe.streams.some(s=>s.codec_type===streamType))throw new Error('已有'+stage.name+'不能实际解码，请重新选择素材');}if(stage.key==='cover')require('./cover-source.cjs').assertCoverCurrent(this.store,current());if(stage.key==='frame')require('./cover-source.cjs').coverInput(this.store,current());stage.status='reused';}
    else{
     const d=current(),op=(type,work,parameters)=>this.operation(job,stage,type,work,signal,parameters);
     switch(stage.key){
      case'speech':output=await op('speech',ctx=>this.service.providers.speech(d,ctx));this.check(job,signal);this.commit(job,next=>next.voice.audioId=output.id);break;
      case'avatar':{const {avatarContext,avatarCurrent}=require('./avatar-request.cjs'),context=avatarContext(this.store,d);output=await op('avatar',async ctx=>{const asset=await this.service.providers.avatar(d,ctx,context);return avatarCurrent(context.input,this.store,this.store.draft(job.draftId))?asset:{...asset,stale:true};},{input:context.input});this.check(job,signal);if(output.stale)throw Error('视频服务、形象或驱动音频已变化，新产物仅保留在素材库，未进入后续剪辑');this.commit(job,next=>next.video.assetId=output.id);break;}
      case'transcribe':{
       const {asrInput,asrCurrent}=require('./asr-request.cjs'),{subtitleReferenceInput,trustedSubtitleReference}=require('./subtitle-reference.mjs'),hash=require('./subtitle-proofread.cjs').hash,sourceId=d.edit.sourceId||d.video.assetId,input=asrInput(this.store,sourceId),reference=trustedSubtitleReference(d,this.store.data,hash),referenceSignature=hash(JSON.stringify(subtitleReferenceInput(d,this.store.data)));
       output=await op('transcribe',async ctx=>{
        const result=await this.service.providers.transcribe(sourceId,ctx),info=await this.service.media.probe(this.store.asset(sourceId).path),duration=Number(info.format?.duration);
        if(!Number.isFinite(duration)||duration<=0)throw Error('无法核对字幕源视频时长，请检查素材后重试');
        const {recognitionRows,recognitionOptions}=await import('./caption-recognition.mjs'),{alignRowsToReference}=await import('../src/caption-script.mjs'),segments=alignRowsToReference(recognitionRows(result,duration,recognitionOptions(d.edit)),reference?.text||'');
        // 分组字幕供剪辑使用，原始词级结果单独留存，便于核对真实断句边界。
        return {...result,segments,input,reference,referenceSignature,rawRecognition:result,...(!asrCurrent(this.store,input)||referenceSignature!==hash(JSON.stringify(subtitleReferenceInput(this.store.draft(job.draftId),this.store.data)))?{stale:true}:{})};
       });this.check(job,signal);if(output.stale)throw Error('识别配置、视频或讲稿已变化，原始识别已保留在执行记录，本次字幕未写入');this.commit(job,next=>next.edit.captions=output.segments);break;
      }
      case'render':output=await op('render',ctx=>this.service.pipMatching?this.service.pipMatching.render(d,ctx):this.service.media.render(d,ctx));this.check(job,signal);this.commit(job,next=>next.edit.resultId=output.id);break;
      case'title':output=await op('title',ctx=>require('./title-copy.cjs').generateCoverTitle(this.service.providers,d,this.store.data,ctx));this.check(job,signal);if(output.quality?.status==='rejected')throw Error('标题未通过内容检查：'+output.quality.issues.join('；'));if(!(await import('./text-input.mjs')).textInputMatches(output.input,this.store.draft(job.draftId),'title',this.store.data))throw Error('标题提示词或输入已变化，原标题保留');this.commit(job,next=>{next.cover.title=output.text.trim();if(next.cover.scene){const main=next.cover.scene.layers.find(l=>l.id==='main');if(main){main.text=next.cover.title;main.binding='title';}}});break;
      case'frame':{const source=d.edit.resultId||d.edit.sourceId||d.video.assetId;output=await op('frame',ctx=>this.service.media.frame(source,0,ctx));this.check(job,signal);this.commit(job,next=>{next.cover.backgroundId=output.id;next.cover.frameTime=0;});break;}
      case'cover':output=await op('cover',async ctx=>{const cover=structuredClone(d.cover),signature=JSON.stringify({...cover,assetId:undefined,videoId:undefined}),base64=await this.service.renderCover(cover,ctx);this.check(job,signal);return this.service.handlers.saveCover({id:job.draftId,base64,signature},{workflowJobId:job.id});});job.expectedInput=workflowInput(this.store.draft(job.draftId));this.check(job,signal);break;
      case'metadata':{const schema={type:'object',properties:{title:{type:'string'},description:{type:'string'},tags:{type:'array',items:{type:'string'}}},required:['title','description','tags'],additionalProperties:false};output=await op('publish-metadata',ctx=>this.service.providers.text('请根据实际文案生成中文发布标题、描述和话题标签。不得虚构事实。仅输出符合JSON格式的对象。','文案：\n'+downstreamDraft(d).finalText,ctx,{schema}));let value;try{value=JSON.parse(output.text);}catch{throw new Error('发布信息模型返回无效JSON，请重试或手动填写');}if(typeof value.title!=='string'||!value.title.trim()||typeof value.description!=='string'||!value.description.trim()||!Array.isArray(value.tags)||value.tags.some(v=>typeof v!=='string'||!v.trim()))throw new Error('发布信息模型返回格式不完整');this.check(job,signal);this.commit(job,next=>{if(!next.publish.title.trim())next.publish.title=value.title.trim();if(!next.publish.description.trim())next.publish.description=value.description.trim();if(!next.publish.tags.length)next.publish.tags=value.tags;next.publish.videoId=next.edit.resultId||next.video.assetId;next.publish.coverId=next.cover.assetId;});break;}
      default:throw new Error('自动流程遇到未知阶段');
     }
     if(output?.id)stage.assetId=output.id;stage.status='succeeded';
    }
    stage.endedAt=stamp();job.progress=Math.round(job.stages.filter(s=>['succeeded','reused','skipped'].includes(s.status)).length/(job.stages.length-1)*100);this.store.save();
   }
  }catch(error){const stage=job.stages.find(s=>s.status==='running');if(stage){stage.status=error.unknown?'unknown':signal.aborted?'cancelled':'failed';stage.error=error.message;stage.endedAt=stamp();}job.status=error.unknown?'unknown':signal.aborted?'cancelled':'failed';job.error=error.unknown?'已停止本地查询，远程结果仍待确认，请保留远程ID。':error.message;job.endedAt=stamp();this.store.save();}
  finally{this.controllers.delete(job.id);}
 }
 stop(id){const job=(this.store.data.workflowJobs||[]).find(j=>j.id===id);if(!job||!['queued','running','stopping'].includes(job.status))throw new Error('该自动流程已结束或不在运行中');if(job.status==='queued'){job.status='cancelled';job.phase='排队已取消';job.endedAt=stamp();this.store.save();return true;}job.status='stopping';job.phase='正在停止';this.store.save();this.controllers.get(id)?.abort();return true;}
}
module.exports={WorkflowJobs};
