function silenceOptions(edit){
  const noise=Number(edit.silenceThreshold??-35),minimum=Number(edit.silenceMinimum??.35),padding=Number(edit.silencePadding??.09);
  if(!Number.isFinite(noise)||noise< -80||noise> -10||!Number.isFinite(minimum)||minimum<.1||minimum>3||!Number.isFinite(padding)||padding<0||padding>.4)throw new Error('剪气口参数无效：阈值-80至-10dB，最短静音0.1至3秒，保留0至0.4秒');
  return {noise,minimum,padding};
}
function silenceTimeline(log,duration,padding){
  if(!Number.isFinite(duration)||duration<=0)throw new Error('无法确定剪气口源文件时长');
  const silence=[];let start;
  for(const match of log.matchAll(/silence_(start|end):\s*(-?\d+(?:\.\d+)?)/g)){
    const time=Math.max(0,Math.min(duration,Number(match[2])));
    if(match[1]==='start')start=time;else if(start!==undefined){if(time>start)silence.push({start,end:time});start=undefined;}
  }
  if(start!==undefined&&duration>start)silence.push({start,end:duration});
  const removed=[];
  for(const interval of silence){const a=interval.start<=.005?0:interval.start+padding,b=interval.end>=duration-.005?duration:interval.end-padding;if(b-a>.02)removed.push({start:a,end:b});}
  const merged=[];
  for(const interval of removed.sort((a,b)=>a.start-b.start)){const previous=merged.at(-1);if(previous&&interval.start<=previous.end)previous.end=Math.max(previous.end,interval.end);else merged.push({...interval});}
  const keep=[];let cursor=0;
  for(const interval of merged){if(interval.start-cursor>.02)keep.push({start:cursor,end:interval.start});cursor=Math.max(cursor,interval.end);}
  if(duration-cursor>.02)keep.push({start:cursor,end:duration});
  if(!keep.length)throw new Error('整段音轨均低于静音阈值，没有可保留内容；请降低阈值或关闭剪气口');
  if(keep.length>128)throw new Error('静音裁切超过128段，请提高最短静音时长后重试');
  const keptDuration=keep.reduce((n,i)=>n+i.end-i.start,0);
  return {sourceDuration:duration,duration:keptDuration,removedDuration:duration-keptDuration,keep,removed:merged};
}
function remapCaptions(captions,keep){
  const result=[];let offset=0;
  for(const interval of keep){for(const row of captions){const a=Math.max(row.start,interval.start),b=Math.min(row.end,interval.end);if(b-a>.01)result.push({...row,start:offset+a-interval.start,end:offset+b-interval.start});}offset+=interval.end-interval.start;}
  return result.sort((a,b)=>a.start-b.start||a.end-b.end);
}
async function detectSilence(media,assetId,edit,ctx,runProcess){
  const source=media.store.asset(assetId),info=await media.probe(source.path);
  if(!info.streams.some(s=>s.codec_type==='audio'))throw new Error('源视频没有音轨，无法检测气口');
  const options=silenceOptions(edit);let log='';
  await runProcess(media.binaries().ffmpeg,['-hide_banner','-nostats','-i',source.path,'-map','0:a:0','-vn','-af',`silencedetect=noise=${options.noise}dB:d=${options.minimum}`,'-f','null','-'],{signal:ctx.signal,onStderr:chunk=>{log+=chunk;if(log.length>2000000)throw new Error('静音检测日志超限，请拆分源视频');}});
  return {...silenceTimeline(log,Number(info.format.duration),options.padding),options};
}
module.exports={silenceOptions,silenceTimeline,remapCaptions,detectSilence};
