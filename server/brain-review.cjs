const crypto=require('node:crypto');
const {digest}=require('./materials.cjs');
const {studyPrompt}=require('./brain-study-prompt.cjs');
async function sourceHash(file,ctx){try{return await digest(file,ctx.signal);}catch(error){ctx.signal.throwIfAborted();throw Error('原视频无法读取，请恢复素材文件后重试',{cause:error});}}

function reviewedText(segments,original){
 if(!Array.isArray(segments)||segments.length!==original.length)throw Error('校对必须保留原有分句及时间范围');
 const rows=segments.map((item,index)=>{const source=original[index];if(!item||item.start!==source.start||item.end!==source.end)throw Error('校对只能修改文字，不能改变原始时间范围');if(typeof item.text!=='string'||!item.text.trim())throw Error('第'+(index+1)+'句转写不能为空');return {start:source.start,end:source.end,text:item.text.trim()};});
 const text=rows.map(item=>item.text).join('');if(text.length<20||text.length>30000)throw Error('校对转写需为20至30000字');return {text,segments:rows};
}

async function review(brain,{id,brainId,revision,segments}){
 const {store,service}=brain,prior=structuredClone(brain.profile(brainId)),draft=structuredClone(store.draft(id));
 if(typeof revision!=='string'||revision!==prior.revision)throw Error('档案已变化，请重新打开校对');
 if(prior.sources?.length!==1||prior.sources[0].kind!=='local-video'||!prior.sources[0].media?.transcription?.segments?.length)throw Error('该档案没有可校对的本地视频转写');
 if(store.data.runs.some(run=>run.status==='unknown'&&run.type==='brain-study'&&(run.draftId===id||run.parameters?.brainId===brainId)))throw Error('学习远程结果尚待确认，不能覆盖该档案');
 const source=prior.sources[0],asset=structuredClone(store.asset(source.assetId)),corrected=reviewedText(segments,source.media.transcription.segments),signature=JSON.stringify({brain:draft.brain,sourceText:draft.sourceText}),configuration=brain.video.configuration();
 if(asset.type!=='video'||!source.media.fileHash)throw Error('原视频来源不完整，请重新导入学习');
 if(brain.video.locks.has(asset.id))throw Error('此视频正在学习，请先等待或停止');
 brain.video.locks.add(asset.id);
 try{return await brain.locked(brainId,()=>service.runtime.run('brain-review',id,{brainId,revision,assetId:asset.id,segments:corrected.segments},async ctx=>{
  const evidence={sourceAssetId:asset.id,fileHash:source.media.fileHash,originalTranscription:structuredClone(source.media.transcription),previousReviewedTranscription:source.media.reviewedTranscription||null,correctedTranscription:corrected};
  try{
   ctx.progress(5,'正在核对原视频来源');if(await sourceHash(asset.path,ctx)!==source.media.fileHash)throw Error('原视频文件已变化，请重新识别后校对');
   const prompt=studyPrompt(prior.mode,corrected.text);evidence.analysisBasis={kind:prompt.basis,promptVersion:prompt.version,source:'reviewed-transcription'};
   ctx.progress(25,'正在按校对文字重新分析');const response=await service.providers.text(prompt.system,prompt.user,ctx,{schema:prompt.schema});evidence.analysisResponse=response;ctx.signal.throwIfAborted();
   let value;try{value=JSON.parse(response.text.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw Error('学习模型返回无效JSON，校对内容未覆盖原档案');}
   const analysis=require('./brain.cjs').validateAnalysis(value,corrected.text);
   const currentAsset=store.data.assets.find(item=>item.id===asset.id),unchanged=currentAsset?.path===asset.path&&currentAsset?.type==='video'&&configuration===brain.video.configuration()&&brain.check(id,signature,brainId,JSON.stringify({name:prior.name,url:prior.url,analysis:prior.analysis,sampleText:prior.sampleText,mode:prior.mode,learnedAt:prior.learnedAt,revision:prior.revision}),ctx);
   if(!unchanged||await sourceHash(asset.path,ctx)!==source.media.fileHash)return {analysis,evidence,stale:true};
   const editedAt=new Date().toISOString(),item={...prior,sampleText:corrected.text,analysis,revision:crypto.randomUUID(),learnedAt:editedAt,topics:null,candidates:null};
   const nextSource=item.sources[0];nextSource.text=corrected.text;nextSource.media={...nextSource.media,reviewedTranscription:{...corrected,origin:'manual',basisFileHash:source.media.fileHash,baseRevision:prior.revision,editedAt,timing:'original-segment-boundaries'},analysisBasis:evidence.analysisBasis,analysisResponse:response};
   const current=structuredClone(store.draft(id));if(current.brain.activeId===brainId){current.brain={...current.brain,sampleText:corrected.text,analysis,analysisRevision:item.revision};delete current.brain.selection;}
   brain.commit(store.data.brains.map(b=>b.id===brainId?item:b),current.brain.activeId===brainId?current:undefined);return {brain:structuredClone(item),analysis,evidence};
  }catch(error){error.evidence=evidence;throw error;}
 }));}finally{brain.video.locks.delete(asset.id);}
}
module.exports={review,reviewedText};
