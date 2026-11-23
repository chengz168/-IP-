const fs=require('node:fs'),crypto=require('node:crypto');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const jsonHash=value=>digest(JSON.stringify(value));
const fileHash=require('./publish-jobs.cjs').hashFile;
const reviewItems=[
 {id:'facts',label:'文案与商品或参考资料一致，没有编造功效、数据或经历'},
 {id:'visual',label:'人物、商品结构、颜色、背景与参考一致，没有明显变形'},
 {id:'motion',label:'完整播放后，动作、镜头衔接及口型符合内容'},
 {id:'audio',label:'已开启声音试听，语气自然，音画匹配，没有爆音或截断'},
 {id:'captions',label:'字幕、屏显文字、封面与时间轴已核对，无错字或遮挡'}
];
function inputOf(d){
 return {confirmed:d.confirmed,finalText:d.finalText,sourceText:d.sourceText,rewrite:d.rewrite,language:d.language,voice:d.voice,video:d.video,edit:d.edit,cover:d.cover,publish:{videoId:d.publish?.videoId,coverId:d.publish?.coverId,title:d.publish?.title,description:d.publish?.description,tags:d.publish?.tags},referenceSelection:d.referenceSelection,productSelection:d.productSelection,product:d.product,story:d.story,creativePreset:d.creativePreset};
}
class ProductionReview{
 constructor({store,media}){Object.assign(this,{store,media});}
 active(id){if(this.store.data.runs.some(r=>r.draftId===id&&['running','queued','unknown'].includes(r.status))||require('./workflow-state.cjs').workflowActive(this.store.data,id))throw Error('此任务仍在执行或结果待确认，请完成、停止或核对原任务后保存质量复核');}
 freeze(id){
  const d=this.store.draft(id),videoId=d.publish?.videoId||d.edit?.resultId||d.video?.assetId||'',refs=new Map();
  const add=(assetId,role)=>{if(!assetId)return;const prior=refs.get(assetId);if(prior){prior.roles.push(role);return;}let a;try{a=this.store.asset(assetId);}catch{refs.set(assetId,{id:assetId,name:assetId,roles:[role],error:'素材记录不存在'});return;}const row={id:a.id,name:a.name||a.id,type:a.type,roles:[role]};try{row.sha256=fileHash(a.path);row.size=fs.statSync(a.path).size;}catch{row.error='素材文件缺失、为空或不可读取';}refs.set(assetId,row);};
  add(videoId,'待交付视频');add(d.edit?.sourceId||d.video?.assetId,'剪辑源视频');add(d.voice?.audioId,'配音');add(d.video?.audioId,'视频驱动音频');add(d.publish?.coverId||d.cover?.assetId,'封面');
  if(d.edit?.bgmEnabled)add(d.edit.bgmId,'背景音乐');if(d.edit?.sfxEnabled)add(d.edit.sfxId,'音效');if(d.edit?.pipEnabled){add(d.edit.pipId,'画中画');for(const row of d.edit.captions||[])add(row.pipId,'逐句画中画');}
  const episode=d.story?.episodes?.find(e=>e.id===d.story.activeEpisodeId&&e.resultId===videoId);
  if(episode){add(episode.resultNarrationAssetId,'分集旁白');for(const sh of episode.shots||[]){add(sh.selectedVideoId,'镜头视频');add(sh.selectedImageId,'镜头首帧');}}
  const media=[...refs.values()],input=inputOf(d);return {videoId,media,fingerprint:jsonHash({input,media}),input};
 }
 async get({id}){
  const snapshot=this.freeze(id),checks=[{id:'video',passed:!!snapshot.videoId,label:snapshot.videoId?'已选择待交付视频':'尚未选择待交付视频'}];
  for(const row of snapshot.media)checks.push({id:'file:'+row.id,passed:!row.error,label:row.error?row.name+'：'+row.error:row.name+'：文件可读取，已冻结内容摘要'});
  const selected=snapshot.media.find(row=>row.id===snapshot.videoId);let duration=0;
  if(selected&&!selected.error){try{const info=await this.media.probe(this.store.asset(selected.id).path);duration=Number(info.format?.duration);const valid=selected.type==='video'&&info.streams?.some(s=>s.codec_type==='video')&&Number.isFinite(duration)&&duration>0;checks.push({id:'decode',passed:!!valid,label:valid?'视频轨道可解析，时长 '+duration.toFixed(2)+' 秒':'所选文件缺少有效视频轨道或时长'});}catch(error){checks.push({id:'decode',passed:false,label:'视频解析失败：'+error.message});}}
  if(snapshot.input.edit?.subtitlesEnabled){const rows=snapshot.input.edit.captions||[];const valid=rows.every(row=>Number.isFinite(row.start)&&Number.isFinite(row.end)&&row.start>=0&&row.end>row.start&&(!duration||row.end<=duration+.15)&&typeof row.text==='string'&&!!row.text.trim());checks.push({id:'captions',passed:!!rows.length&&valid,label:rows.length&&valid?'已存在有效格式的字幕时间段；文字与音画仍需人工核对':'已开启字幕，但字幕缺失、格式无效或超过所选视频时长'});}
  // 异步探测期间可能发生编辑或文件替换，禁止把旧检查附着到新内容。
  if(this.freeze(id).fingerprint!==snapshot.fingerprint)throw Error('检查期间文案、设置或媒体已变化，请重新检查');
  const history=structuredClone(this.store.draft(id).artifacts?.productionReviews||[]),latest=history[0]||null,currentReview=latest?.fingerprint===snapshot.fingerprint?latest:null;
  return {draftId:id,fingerprint:snapshot.fingerprint,historyVersion:jsonHash(history),videoId:snapshot.videoId,duration:duration||null,media:snapshot.media,checks,technicalPassed:checks.every(row=>row.passed),items:reviewItems,currentReview,status:currentReview?.status||(latest?'stale':'unchecked'),history};
 }
 async save({id,fingerprint,historyVersion,status,checked,notes}){
  this.active(id);
  if(!['approved','needs-changes'].includes(status)||typeof notes!=='string'||notes.length>4000||!checked||typeof checked!=='object'||Array.isArray(checked))throw Error('质量复核输入无效');
  if(status==='needs-changes'&&!notes.trim())throw Error('请填写需要修改的具体问题');
  const view=await this.get({id});this.active(id);
  if(view.fingerprint!==fingerprint||view.historyVersion!==historyVersion)throw Error('作品或复核记录已变化，请刷新后重新检查，本次没有覆盖旧记录');
  if(!view.videoId)throw Error('请先生成或选择待交付视频');
  if(status==='approved'&&(!view.technicalPassed||reviewItems.some(item=>checked[item.id]!==true)))throw Error('请先解决技术检查问题，并逐项完成实际人工审看后再标记通过');
  const d=this.store.draft(id),prior=structuredClone(d.artifacts),record={id:crypto.randomUUID(),fingerprint,videoId:view.videoId,status,checked:Object.fromEntries(reviewItems.map(item=>[item.id,checked[item.id]===true])),notes:notes.trim(),method:'human-review',reviewedAt:new Date().toISOString(),media:view.media,technicalChecks:view.checks};
  d.artifacts??={};d.artifacts.productionReviews=[record,...(d.artifacts.productionReviews||[])];
  try{this.store.save();}catch(error){if(prior===undefined)delete d.artifacts;else d.artifacts=prior;throw error;}
  return {...view,historyVersion:jsonHash(d.artifacts.productionReviews),currentReview:structuredClone(record),status,history:structuredClone(d.artifacts.productionReviews)};
 }
}
module.exports={ProductionReview,reviewItems,inputOf};
