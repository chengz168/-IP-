const labels={queued:'排队中',running:'处理中',stopping:'正在停止',failed:'失败',cancelled:'已取消',unknown:'远程结果待确认',interrupted:'已中断',awaiting_publish:'成片就绪，待发布'};
const stageIndices={speech:2,avatar:3,transcribe:4,render:4,title:5,frame:5,cover:5,metadata:6,publish:6};

// 按键排序只消除对象属性顺序差异；字幕、镜头、图层等数组顺序仍有制作含义。
function ordered(value){if(Array.isArray(value))return value.map(ordered);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,ordered(value[key])]));return value;}
const signature=value=>JSON.stringify(ordered(value));
function completedDraft(job){try{const value=JSON.parse(job.expectedInput);return value&&typeof value==='object'&&!Array.isArray(value)?value:null;}catch{return null;}}
export function productionSignature(draft){const cover={...draft.cover},video={...draft.video};delete cover.videoId;delete video.routing;return signature({confirmed:draft.confirmed,finalText:draft.finalText,voice:draft.voice,video,edit:draft.edit,cover});}

export function skippedVoice(job,draft,videoAvailable){
 const snapshot=completedDraft(job),speech=job?.stages?.find(stage=>stage.key==='speech'),avatar=job?.stages?.find(stage=>stage.key==='avatar');
 return !!(snapshot&&speech?.action==='skip'&&speech.status==='skipped'&&['reused','succeeded'].includes(avatar?.status)&&draft.edit.sourceId&&videoAvailable&&avatar.assetId===draft.edit.sourceId&&snapshot.edit?.sourceId===draft.edit.sourceId&&snapshot.confirmed&&draft.confirmed&&snapshot.finalText===draft.finalText);
}

// 历史执行状态不回写；当前投影只在本次读取时根据草稿和真实素材检查派生。
export function workflowView(job,draft,{available=()=>false,unsettled=''}={}){
 if(!job)return null;
 const working=job.stages?.find(stage=>['running','unknown','failed','interrupted','cancelled'].includes(stage.status));
 const base={jobId:job.id,status:job.status,label:labels[job.status]||job.status,message:job.error||job.phase||'',current:true,pendingStep:stageIndices[working?.key]??6};
 if(job.status!=='awaiting_publish')return base;
 if(unsettled==='unknown')return {...base,status:'unknown',label:labels.unknown,message:'该任务另有远程结果待确认，历史成片不代表当前执行已经结束。',current:false};
 if(unsettled==='running')return {...base,status:'running',label:labels.running,message:'当前正在处理新的内容，历史成片不代表本次处理已经完成。',current:false};
 const stale=(message,pendingStep)=>({...base,status:'stale',label:'需重新处理',message,current:false,pendingStep});
 if(!draft.confirmed||!draft.finalText?.trim())return stale('最终文案尚未确认，请确认文案后重新处理。',1);
 if(!available(draft.edit.resultId,'video'))return stale('当前剪辑结果已失效或文件不可用，请重新剪辑。',4);
 if(!available(draft.cover.assetId,'image'))return stale('当前封面已失效或文件不可用，请重新生成封面。',5);
 const snapshot=completedDraft(job);
 if(!snapshot)return stale('历史流程缺少可核对的完成快照，请核对当前内容后重新处理。',6);
 if(productionSignature(snapshot)!==productionSignature(draft))return stale('制作输入或结果已更改，历史成片不能代表当前内容，请重新处理。',4);
 if(draft.publish.videoId&&![draft.edit.resultId,draft.cover.videoId].filter(Boolean).includes(draft.publish.videoId))return stale('发布视频已更换，请核对当前发布素材后重新处理。',6);
 if(draft.publish.coverId&&draft.publish.coverId!==draft.cover.assetId)return stale('发布封面已更换，请核对当前发布素材后重新处理。',6);
 if(!draft.publish.title?.trim()||!draft.publish.description?.trim()||!Array.isArray(draft.publish.tags)||!draft.publish.tags.length||draft.publish.tags.some(tag=>typeof tag!=='string'||!tag.trim()))return stale('发布标题、描述或标签尚未完整，请补齐后继续。',6);
 return {...base,pendingStep:6,message:'真实媒体已生成，尚未上传平台。'};
}
