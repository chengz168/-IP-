const fs=require('node:fs');
const crypto=require('node:crypto');
const {hash}=require('./story-contract.cjs');
const content=value=>Array.from(String(value||'')).filter(char=>/[\p{L}\p{N}]/u.test(char)).join('');
const fileHash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function narrationSource(store,draft,story,episode){
 if(story.narrationMode!=='upstream')throw Error('请先选择使用第三步配音或本集指定旁白');
 const audioId=episode.narrationAssetId||(story.episodes.length===1?draft.voice?.audioId:'');
 if(!audioId)throw Error('请先为当前集生成或选择对应旁白音频');
 const audio=store.asset(audioId);if(audio.type!=='audio')throw Error('当前集旁白必须为音频素材');
 const {speechContext,speechRequest,speechEvidence}=require('./speech-request.cjs');
 const expected=speechEvidence(speechRequest({...draft,finalText:episode.text},speechContext(store.data)));
 if(!audio.speech?.request||hash(audio.speech.request)!==hash(expected))throw Error('当前集旁白与台词或声音设置不一致，请重新生成对应配音');
 return {audioId,audioSha256:fileHash(audio.path),request:expected};
}

// 与商品介绍共用真实段落边界原则；词内插值必须显式允许且留下估计标记。
async function alignNarrationShots(shots,episodeText,recognition,duration,{allowEstimated=false,allowReferenceMapping=false}={}){
 if(typeof allowEstimated!=='boolean')throw Error('是否允许估计边界必须为布尔值');
 if(typeof allowReferenceMapping!=='boolean')throw Error('是否允许可信稿映射必须为布尔值');
 if(!Array.isArray(shots)||!shots.length||shots.map(shot=>shot.text).join('')!==episodeText)throw Error('镜头台词没有逐字覆盖当前集正文，旧镜头保留');
 if(!Number.isFinite(duration)||duration<=0||duration>600)throw Error('当前集旁白时长须大于0且不超过600秒');
 const {recognitionRows,validatedWords}=await import('./caption-recognition.mjs');
 const rows=recognitionRows(recognition,duration);
 // 严格路径也必须先比较量值；只保留字母和数字会把1.2、12及12%误判成相同正文。
 try{require('./narration-reference.cjs').assertNumericFidelity(rows.map(row=>row.text).join(''),episodeText);}catch(error){throw Error('旁白识别与当前集正文无法逐字匹配：'+error.message);}
 const expected=content(episodeText),detected=content(rows.map(row=>row.text).join(''));
 // 仅在显式选择可信稿映射且严格文字不匹配时启用，原识别与差异审计由映射器保留。
 if(expected&&expected!==detected&&allowReferenceMapping){
  const mappingFile=require('node:path').join(__dirname,'narration-reference.cjs');
  if(!fs.existsSync(mappingFile))throw Error('当前环境尚未启用可信稿映射，原识别和旧镜头保留，请先核对旁白与正文');
  return require(mappingFile).mapNarrationReference(shots,episodeText,recognition,duration,{allowEstimated});
 }
 if(!expected||expected!==detected)throw Error('旁白识别与当前集正文无法逐字匹配，未改写文字或估算时间轴');
 const counts=shots.map(shot=>content(shot.text).length);if(counts.some(count=>!count))throw Error('镜头台词缺少可对齐的正文文字');
 const units=[];let cursor=0,wordBoundaryCount=0;
 for(let index=0;index<rows.length;index++){
  const row=rows[index],words=validatedWords(recognition.segments[index],duration);
  for(const item of words||[{start:row.start,end:row.end,word:row.text}]){
   const count=content(item.word).length;if(!count)continue;
   units.push({from:cursor,to:cursor+count,start:item.start,end:item.end,method:words?'asr-word-end':'asr-segment-end'});cursor+=count;if(words)wordBoundaryCount++;
  }
 }
 const boundaries=[{frame:0,method:'audio-start'}];let used=0,estimatedBoundaries=0;
 for(let index=0;index<shots.length-1;index++){
  used+=counts[index];const unit=units.find(item=>used>item.from&&used<=item.to);if(!unit)throw Error('镜头台词无法对应真实识别边界');
  let time,method;
  if(used===unit.to){time=unit.end;method=unit.method;}
  else{
   if(!allowEstimated)throw Error('第'+(index+1)+'镜头切点落在识别段落或词内部；请调整台词切点，或明确允许估计后重试');
   time=unit.start+(unit.end-unit.start)*(used-unit.from)/(unit.to-unit.from);method=unit.method==='asr-word-end'?'asr-word-interpolation-estimate':'asr-segment-interpolation-estimate';estimatedBoundaries++;
  }
  boundaries.push({frame:Math.round(time*24),method});
 }
 boundaries.push({frame:Math.ceil(duration*24),method:'audio-end-frame-ceiling'});
 const timed=shots.map((shot,index)=>{const start=boundaries[index].frame/24,end=boundaries[index+1].frame/24;if(end-start<.1)throw Error('第'+(index+1)+'镜头实际台词不足0.1秒，请先合并镜头；旧镜头保留');return {shotId:shot.id,start,end,duration:end-start,startMethod:boundaries[index].method,endMethod:boundaries[index+1].method};});
 const limitations=timed.filter(shot=>shot.duration<4||shot.duration>15).map(shot=>({shotId:shot.shotId,duration:shot.duration,reason:'当前普通H3单镜头支持4至15秒，请先拆分或合并镜头；未裁剪旁白'}));
 return {version:1,method:estimatedBoundaries?'asr-boundaries-with-explicit-interpolation':'asr-exact-text-boundaries',duration,timelineDuration:timed.at(-1).end,estimatedBoundaries,wordBoundaryCount,allowEstimated,requiresReview:true,limitations,shots:timed};
}
const timingInput=episode=>hash({text:episode.text,narrationAssetId:episode.narrationAssetId||'',shots:episode.shots.map(shot=>({id:shot.id,text:shot.text,duration:shot.duration}))});
function validateNarrationTiming(store,draft,story,episode){
 // 无旁白模式不消费对齐凭据，保留失效历史供切回上游旁白时继续校验。
 if(story.narrationMode==='none')return null;
 const timing=episode.narrationTiming;if(timing===undefined)return null;
 const invalid=()=>Error('当前集旁白对齐凭据已失效，请按当前旁白重新对齐镜头后合成');
 if(!timing||timing.invalidated===true||timing.version!==1||!Array.isArray(timing.shots)||timing.shots.length!==episode.shots.length||episode.shots.map(shot=>shot.text).join('')!==episode.text)throw invalid();
 let source;try{source=narrationSource(store,draft,story,episode);}catch(error){throw Error(invalid().message+'：'+error.message);}
 if(timing.audioId!==source.audioId||timing.audioSha256!==source.audioSha256||hash(timing.request||null)!==hash(source.request)||timing.inputHash!==timingInput(episode))throw invalid();
 // 校验完整连续时间轴及每镜时长，不能只凭旁白总时长相同就复用旧切点。
 let end=0;
 for(let index=0;index<episode.shots.length;index++){
  const shot=episode.shots[index],row=timing.shots[index];
  if(!row||row.shotId!==shot.id||![row.start,row.end,row.duration,shot.duration].every(Number.isFinite)||row.duration<=0||Math.abs(row.start-end)>1e-6||Math.abs(row.end-row.start-row.duration)>1e-6||Math.abs(row.duration-shot.duration)>1e-6)throw invalid();
  end=row.end;
 }
 if(!Number.isFinite(timing.duration)||timing.duration<=0||timing.duration>600||!Number.isFinite(timing.timelineDuration)||Math.abs(timing.timelineDuration-end)>1e-6||Math.abs(Math.ceil(timing.duration*24)/24-end)>1e-6)throw invalid();
 // 把全部对齐凭据摘要冻结进合成输入，识别方式或切点改变也须重新合成。
 return {version:1,sha256:hash(timing),inputHash:timing.inputHash,audioId:source.audioId,audioSha256:source.audioSha256,requestHash:hash(source.request)};
}
module.exports={alignNarrationShots,narrationSource,timingInput,fileHash,validateNarrationTiming};
