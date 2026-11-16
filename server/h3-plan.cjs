const crypto=require('node:crypto');
const sampleRate=32000,fps=24;
const digest=value=>crypto.createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');

function quietSpans(pcm){
 const samples=pcm.length/2,window=640,result=[];let start;
 for(let at=0;at<samples;at+=window){
  const end=Math.min(samples,at+window);let sum=0;
  for(let i=at;i<end;i++){const value=pcm.readInt16LE(i*2)/32768;sum+=value*value;}
  const quiet=Math.sqrt(sum/(end-at))<10**(-35/20);
  if(quiet&&start===undefined)start=at;
  if((!quiet||end===samples)&&start!==undefined){const stop=quiet?end:at;if(stop-start>=sampleRate*.12)result.push({start,end:stop});start=undefined;}
 }
 return result;
}

function audioTimeline(pcm){
 if(!Buffer.isBuffer(pcm)||!pcm.length||pcm.length%2)throw Error('长片驱动必须是有效的32k单声道16位PCM');
 const totalSamples=pcm.length/2,totalFrames=Math.ceil(totalSamples*fps/sampleRate),duration=totalSamples/sampleRate;
 return {sampleRate,fps,totalSamples,totalFrames,duration};
}

function frameRangeSegments(timeline,rangeStart,rangeEnd,quiet){
 const span=rangeEnd-rangeStart,count=span<=15*fps?1:Math.ceil(span/(10*fps)),segments=[];let startFrame=rangeStart;
 for(let index=0;index<count;index++){
  const remaining=count-index-1;
  let endFrame=rangeEnd,boundary='end';
  if(remaining){
   const low=Math.max(startFrame+4*fps,rangeEnd-remaining*12*fps),high=Math.min(startFrame+12*fps,rangeEnd-remaining*4*fps);
   const target=Math.max(low,Math.min(high,rangeStart+Math.round(span*(index+1)/count)));
   const candidates=quiet.map(span=>Math.round((span.start+span.end)*fps/(2*sampleRate))).filter(frame=>frame>=low&&frame<=high&&Math.abs(frame-target)<=1.2*fps);
   endFrame=candidates.sort((a,b)=>Math.abs(a-target)-Math.abs(b-target))[0]??target;boundary=candidates.length?'silence':'frame';
  }
  const startSample=Math.round(startFrame*sampleRate/fps),endSample=Math.min(timeline.totalSamples,Math.round(endFrame*sampleRate/fps));
  segments.push({index,startFrame,endFrame,frameCount:endFrame-startFrame,startSample,endSample,duration:(endSample-startSample)/sampleRate,boundary});startFrame=endFrame;
 }
 return segments;
}

function segmentPlan(pcm){
 const timeline=audioTimeline(pcm);
 if(timeline.duration<=15)throw Error('分段计划只用于超过15秒的驱动音轨');
 return {version:'h3-segment-plan-v1',...timeline,segments:frameRangeSegments(timeline,0,timeline.totalFrames,quietSpans(pcm))};
}

function multiShotPlan(pcm,shots){
 const timeline=audioTimeline(pcm);
 if(!Array.isArray(shots)||!shots.length||shots.some(shot=>!shot||typeof shot.avatarId!=='string'||!shot.avatarId||typeof shot.duration!=='number'||!Number.isFinite(shot.duration)||shot.duration<=0))throw Error('本地多镜头需要有效形象和正数时长');
 const requestedDuration=shots.reduce((sum,shot)=>sum+shot.duration,0);
 if(!Number.isFinite(requestedDuration)||Math.abs(requestedDuration-timeline.duration)>.051)throw Error('镜头总时长'+requestedDuration.toFixed(3)+'秒与驱动音频'+timeline.duration.toFixed(3)+'秒不一致，请按音频均分或调整镜头时长');
 const quiet=quietSpans(pcm),planned=[],segments=[];let elapsed=0,startFrame=0;
 for(const [index,shot]of shots.entries()){
  elapsed+=shot.duration;
  const endFrame=index===shots.length-1?timeline.totalFrames:Math.round(elapsed*fps);
  if(endFrame<=startFrame||endFrame>timeline.totalFrames)throw Error('镜头'+(index+1)+'量化到24fps后没有有效画面，请调整镜头时长');
  const startSample=Math.round(startFrame*sampleRate/fps),endSample=Math.min(timeline.totalSamples,Math.round(endFrame*sampleRate/fps));
  planned.push({index,avatarId:shot.avatarId,requestedDuration:shot.duration,startFrame,endFrame,frameCount:endFrame-startFrame,startSample,endSample,duration:(endSample-startSample)/sampleRate});
  const parts=frameRangeSegments(timeline,startFrame,endFrame,quiet);
  for(const [partIndex,part]of parts.entries())segments.push({...part,index:segments.length,shotIndex:index,boundary:partIndex===parts.length-1&&index<shots.length-1?'shot':part.boundary});
  startFrame=endFrame;
 }
 return {version:'h3-multi-shot-plan-v1',...timeline,requestedDuration,shots:planned,segments};
}

function h3Prompt(duration){
 if(!Number.isFinite(duration)||duration<=0||duration>15)throw Error('H3片段提示词时长无效');
 // 沿用官方I2VA字段顺序；外部驱动没有已核对正文时，不把草稿文字冒充实际对白。
 return 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\n\n'+
  'integrated_multimodal_description: [Shot 1] Live-action, preserve the person, facial proportions, hairstyle, clothing, composition, lighting and room arrangement visible in <Picture 1>. The camera holds a static shot. The on-screen person (S1) speaks the supplied driving audio, matching its speech timing, pauses and phonemes with natural lip and jaw movements. Keep a stable facial identity, subtle breathing and small restrained movements. Keep the hands in the position established by the first frame. The shot stays continuous for '+duration.toFixed(2)+' seconds. During pauses the lips relax naturally. The image contains only the person and original surroundings, with no subtitles, captions, logos or graphic overlays.\n\n'+
  'overall_soundscape: Preserve the supplied driving audio and its pauses. Quiet room ambience, without added voices or sound effects.\n\n'+
  'non_diegetic_music: N/A';
}

module.exports={sampleRate,fps,digest,quietSpans,segmentPlan,multiShotPlan,h3Prompt};
