const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {runProcess}=require('../../server/media.cjs');
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function rate(value){const parts=String(value).split('/').map(Number);if(parts.length!==2||!parts.every(Number.isFinite)||parts[0]<=0||parts[1]<=0)throw Error('视频帧率无效');return parts[0]/parts[1];}
function planInput(video,audio){
 const picture=video.streams?.find(stream=>stream.codec_type==='video'),sound=audio.streams?.find(stream=>stream.codec_type==='audio');
 if(!picture||!sound)throw Error('形象必须包含视频流，驱动必须包含音频流');
 const duration=Number(sound.duration||audio.format?.duration),fps=rate(picture.avg_frame_rate),nominal=rate(picture.r_frame_rate),sourceFrames=Number(picture.nb_frames),width=Number(picture.width),height=Number(picture.height);
 if(!Number.isFinite(duration)||duration<1||duration>8)throw Error('本轮专用口型验证只接受1至8秒驱动');
 if(Math.abs(fps-nominal)>.001)throw Error('本轮需恒定帧率的视频，请先明确转换后再验证');
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||!Number.isInteger(sourceFrames)||sourceFrames<=0)throw Error('原视频尺寸或帧数不完整');
 const rotation=Number(picture.side_data_list?.find(item=>item.rotation!==undefined)?.rotation||picture.tags?.rotate||0);
 if(!Number.isFinite(rotation)||rotation%360!==0)throw Error('本轮不隐式旋转形象，请先准备方向正确的视频');
 const frameCount=Math.ceil(duration*fps-1e-8);
 if(sourceFrames<frameCount)throw Error('形象视频帧数不足，本轮不自动循环或补帧');
 return {duration,width,height,fps,frameRate:picture.avg_frame_rate,sourceFrameCount:sourceFrames,frameCount,firstSourceFrame:0,lastSourceFrame:frameCount-1,sourceFramePolicy:'first-target-frames-no-loop-v1',sampleRate:16000,channels:1,targetSamples:Math.round(duration*16000)};
}
async function prepareLipSyncInput({videoPath,audioPath,directory,media,signal}){
 for(const file of [videoPath,audioPath])if(!path.isAbsolute(file)||!fs.statSync(file).isFile()||!fs.statSync(file).size)throw Error('输入必须为有效的绝对文件路径');
 if(!path.isAbsolute(directory))throw Error('输入工作目录必须是绝对路径');
 const videoHash=digest(videoPath),audioHash=digest(audioPath),[video,audio]=await Promise.all([media.probe(videoPath),media.probe(audioPath)]),plan=planInput(video,audio);
 // 只创建新的独立目录；既有记录、失败现场和源文件都不覆盖。
 fs.mkdirSync(directory,{recursive:false});
 try{
  const driverPath=path.join(directory,'driver-16k.wav');
  await runProcess(media.binaries().ffmpeg,['-v','error','-n','-i',audioPath,'-map','0:a:0','-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',driverPath],{signal});
  signal?.throwIfAborted();
  const bytes=fs.readFileSync(driverPath);let offset=12,samples;
  if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw Error('规范化驱动不是有效WAV');
  while(offset+8<=bytes.length){const size=bytes.readUInt32LE(offset+4);if(bytes.toString('ascii',offset,offset+4)==='data'){if(offset+8+size>bytes.length||size%2)throw Error('规范化音轨不完整');samples=size/2;break;}offset+=8+size+(size%2);}
  if(samples===undefined||Math.abs(samples-plan.targetSamples)>1)throw Error('规范化音轨采样数与输入时长不一致');
  if(digest(videoPath)!==videoHash||digest(audioPath)!==audioHash)throw Error('准备过程中源文件已变化，未接收输入');
  const manifest={version:1,at:new Date().toISOString(),kind:'musetalk-short-input',...plan,video:{path:videoPath,sha256:videoHash},audio:{path:audioPath,sha256:audioHash},driver:{path:driverPath,sha256:digest(driverPath),samples,sampleRate:16000,channels:1},modelExecuted:false,newVideoGenerated:false,qualityAccepted:false};
  const temporary=path.join(directory,'input.partial.json');fs.writeFileSync(temporary,JSON.stringify(manifest,null,2));fs.renameSync(temporary,path.join(directory,'input.json'));return manifest;
 }catch(error){fs.writeFileSync(path.join(directory,'preparation-failed.json'),JSON.stringify({at:new Date().toISOString(),error:error.message,modelExecuted:false,newVideoGenerated:false},null,2));throw error;}
}
module.exports={planInput,prepareLipSyncInput,digest};
