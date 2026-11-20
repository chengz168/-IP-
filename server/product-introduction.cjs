const fs=require('node:fs');
const crypto=require('node:crypto');
const {hash,uid,createStory,assetInput,shotInput}=require('./story-contract.cjs');
const content=text=>Array.from(String(text)).filter(char=>/[\p{L}\p{N}]/u.test(char));
const stamp=asset=>crypto.createHash('sha256').update(fs.readFileSync(asset.path)).digest('hex');
function checkedAudio(service,draft){
 const audio=service.store.asset(draft.voice.audioId);
 const {speechContext,speechRequest,speechEvidence}=require('./speech-request.cjs');
 const expected=speechEvidence(speechRequest(draft,speechContext(service.store.data)));
 if(audio.type!=='audio'||!audio.speech?.request||hash(audio.speech.request)!==hash(expected))throw Error('第三步配音与当前确认稿或音色不匹配，请重新生成声音');
 return audio;
}
function currentIntroduction(service,draft,story){
 const input=story.productIntroduction;if(!input)return true;
 try{return story.sourceMode==='upstream'&&story.narrationMode==='upstream'&&story.episodeCount===1&&story.episodes.length===1&&story.episodes[0].narrationAssetId===input.audioId&&draft.confirmed&&draft.finalText===story.sourceText&&hash(draft.product)===input.productHash&&draft.voice.audioId===input.audioId&&stamp(checkedAudio(service,draft))===input.audioSha256&&input.images.every(image=>stamp(service.store.asset(image.id))===image.sha256);}catch{return false;}
}
// 使用识别段落的真实边界；落在段内的切点明确记录为插值估计，并量化到视频帧。
function alignShots(shots,rows,duration){
 const expected=shots.map(shot=>content(shot.text).length),total=expected.reduce((a,b)=>a+b,0);
 if(!total||rows.reduce((sum,row)=>sum+content(row.text).length,0)!==total)throw Error('确认稿与识别段落不能逐字对应，未按比例伪造时间轴');
 const frames=Math.ceil(duration*24),boundaries=[{frame:0,method:'audio-start'}];let used=0;
 for(let i=0;i<shots.length-1;i++){
  used+=expected[i];let cursor=0,time,method;
  for(const row of rows){const count=content(row.text).length;
   if(used===cursor+count){time=row.end;method='asr-segment-end';break;}
   if(used>cursor&&used<cursor+count){time=row.start+(row.end-row.start)*(used-cursor)/count;method='asr-segment-interpolation-estimate';break;}cursor+=count;
  }
  if(!Number.isFinite(time))throw Error('无法对应当前镜头台词与真实音频');
  const frame=Math.round(time*24);if(frame-boundaries.at(-1).frame<5)throw Error('部分台词对应镜头不足0.2秒，请先合并过短镜头');boundaries.push({frame,method});
 }
 boundaries.push({frame:frames,method:'audio-end-frame-ceiling'});
 return shots.map((shot,index)=>{const start=boundaries[index].frame/24,end=boundaries[index+1].frame/24;if(end-start<.2||end-start>15)throw Error('第'+(index+1)+'镜头的实际台词时长超出0.2至15秒，请拆分或合并镜头后再准备');return {...shot,start,end,duration:end-start,timing:{start:boundaries[index].method,end:boundaries[index+1].method,requiresReview:true}};});
}
function introductionStory(draft,script,shots,audio,recognition,captions,proofreading,audioSha256=stamp(audio)){
 const s=createStory(draft);Object.assign(s,{episodeCount:1,episodeDuration:shots.at(-1).end,aspect:draft.product.aspect,narrationMode:'upstream',style:'真实产品介绍；以商品原图为外观基准，不改变结构与包装',instructions:'每镜动作须与台词对应。不虚构实测功效；不生成字幕、图标、包装文字或水印。配音来自第三步，镜头不生成对白。'});
 s.episodesSourceHash=hash([s.sourceText,1,s.episodeDuration]);
 s.productIntroduction={version:1,productHash:hash(draft.product),productSnapshot:structuredClone(draft.product),scriptRunId:draft.product.scriptRunId,audioId:audio.id,audioSha256,images:script.images.map(image=>({id:image.id,sha256:image.sha256,role:image.role||'product'})),recognition,captions,proofreading,timingMethod:'asr-segment-boundaries-with-explicit-interpolation',qualityAccepted:false};
 const assets=new Map();
 for(const image of script.images){const a={id:uid(),kind:'prop',role:image.role||'product',name:image.name,description:image.role==='icon'?'原始图标，仅用于确定性叠加':'当前商品的已确认参考图片',prompt:'Preserve the exact referenced product appearance and proportions.',images:[],selectedImageId:image.id};a.images.push({id:image.id,inputHash:hash(assetInput(s,a)),status:'ready',imported:true});s.assets.push(a);assets.set(image.id,a);}
 const e={id:uid(),title:draft.product.title,text:draft.finalText,narrationAssetId:audio.id,resultId:'',results:[],shots:[]};
 for(const sh of shots){const primary=assets.get(sh.imageId);if(!primary||primary.role==='icon')throw Error('商品介绍镜头必须绑定商品或详情图，不能用图标替代商品');
  const iconIds=(sh.iconIndices||[]).map(index=>{const image=script.images[index];if(!image||image.role!=='icon')throw Error('镜头图标只能引用标注为图标的素材');return image.id;});
  const action=sh.action||'请先编辑此镜头与台词对应的产品动作，再生成动态视频';
  const shot={id:uid(),text:sh.text,visual:sh.visual,action,camera:sh.camera||'近景，主体完整可见',sound:'No spoken dialogue. Narration will be added separately.',sellingPoint:sh.sellingPoint||'',evidence:sh.evidence||'',stage:sh.stage||'',iconIds,timing:sh.timing,duration:sh.duration,imagePrompt:sh.visual,videoPrompt:'Use the supplied product image as the first frame. Preserve the exact product silhouette, materials, colors and structure. Show the specific physical action described below. No invented accessories, no spoken dialogue, no generated text, logos or watermarks.',assetIds:[primary.id,...iconIds.map(id=>assets.get(id).id)],primaryReferenceAssetId:primary.id,images:[],videos:[],selectedImageId:sh.imageId,selectedVideoId:''};
  shot.images.push({id:sh.imageId,inputHash:hash(shotInput(s,shot)),status:'ready',imported:true});e.shots.push(shot);
 }
 s.episodes.push(e);return s;
}
async function prepareIntroduction(products,{id}){return products.locked(id,async()=>{
 const service=products.service,d=structuredClone(service.store.draft(id)),p=d.product||{},script=products.report(id,p.scriptRunId,'product-script').output;
 const {form,validateShots,selection}=require('./product-studio.cjs');
 if(!d.confirmed||!d.finalText?.trim())throw Error('请先在第二步确认商品文案');
 if(p.narration!==true||!d.voice.audioId)throw Error('脚本驱动产品介绍需要第三步当前配音，请先生成声音');
 if(hash(form(d))!==hash(script.input)||selection(p)!==script.selectionHash)throw Error('商品资料或所选素材已变化，请先重新生成商品脚本');
 const shots=validateShots(p.shots,script.images);if(shots.map(shot=>shot.text.replace(/\s/g,'')).join('')!==d.finalText.replace(/\s/g,''))throw Error('确认稿与镜头台词不一致，请先同步镜头文案');
 for(const image of script.images)if(stamp(service.store.asset(image.id))!==image.sha256)throw Error('商品原素材已变化，请重新生成脚本');
 const audio=checkedAudio(service,d),audioSha256=stamp(audio),snapshot=hash([d.product,d.finalText,d.voice,audio.speech]);
 if(d.story?.productIntroduction&&currentIntroduction(service,d,d.story))return {story:d.story,unchanged:true,stale:false};
 return products.run('product-introduction',id,{scriptRunId:p.scriptRunId,audioId:audio.id},async ctx=>{
  ctx.progress(5,'正在校验第三步配音与商品脚本');const probe=await service.media.probe(audio.path),duration=Number(probe.format?.duration);
  if(!Number.isFinite(duration)||duration<=0||!probe.streams.some(stream=>stream.codec_type==='audio'))throw Error('第三步配音没有有效音轨');
  ctx.progress(15,'正在提取配音时间轴，建立台词与镜头关联');const recognition=await service.providers.transcribe(audio.id,ctx),{recognitionRows,recognitionOptions}=await import('./caption-recognition.mjs');
  let captions,proofreading;
  try{({captions,proofreading}=require('./product-captions.cjs').productCaptions(recognitionRows(recognition,duration,recognitionOptions(d.edit)),d.finalText));}
  catch(error){error.evidence={recognition,referenceText:d.finalText,audioId:audio.id};throw error;}
  if(stamp(audio)!==audioSha256)throw Error('配音文件在识别期间已变化，请重新生成或核对声音后再准备分镜');
  const timed=alignShots(shots,captions,duration),story=introductionStory(d,script,timed,audio,recognition,captions,proofreading,audioSha256);
  ctx.signal.throwIfAborted();const now=service.store.draft(id);
  if(hash([now.product,now.finalText,now.voice,audio.speech])!==snapshot||!currentIntroduction(service,now,story))return {story,stale:true};
  if(d.story?.episodes?.length)story.productIntroductionHistory=[{savedAt:new Date().toISOString(),story:structuredClone(d.story)},...(d.story.productIntroductionHistory||[])].slice(0,3).map(entry=>{if(entry.story)delete entry.story.productIntroductionHistory;return entry;});
  ctx.progress(95,'商品原图、图标与配音已关联，请逐镜生成并检查动态效果');
  return {story:service.stories.write(id,story),stale:false,timing:timed.map(shot=>({text:shot.text,start:shot.start,end:shot.end,timing:shot.timing})),qualityAccepted:false};
 });
});}
module.exports={prepareIntroduction,currentIntroduction,alignShots,introductionStory,checkedAudio};
