const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {runProcess}=require('./media.cjs');
const maximumBytes=50*1024*1024;
class Recordings{
 constructor(service){this.service=service;}
 async import({id,mimeType,base64}){
  const {store,media,runtime}=this.service;store.draft(id);
  const type=String(mimeType||'').toLowerCase().split(';')[0].trim(),extension={'audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'m4a'}[type];
  if(!extension)throw Error('录音格式不支持，请重新录制或导入已有音频');
  if(typeof base64!=='string'||!base64.length||base64.length>Math.ceil(maximumBytes/3)*4||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))throw Error('录音数据无效或超过50MB，请缩短录制时间后重试');
  const buffer=Buffer.from(base64,'base64');if(!buffer.length||buffer.length>maximumBytes)throw Error('录音数据无效或超过50MB');
  if(store.data.runs.some(run=>run.type==='voice-recording'&&run.draftId===id&&['running','queued'].includes(run.status)))throw Error('该任务正在保存录音，请等待或停止后重试');
  return runtime.run('voice-recording',id,{mimeType:type,bytes:buffer.length,sourceSha256:crypto.createHash('sha256').update(buffer).digest('hex')},async ctx=>{
   const directory=fs.mkdtempSync(path.join(store.outputDir(),'.recording-')),source=path.join(directory,'source.'+extension),output=path.join(directory,'recording.wav');let created;
   try{
    fs.writeFileSync(source,buffer);const info=await media.probe(source),duration=Number(info.format?.duration);
    if(!info.streams.some(stream=>stream.codec_type==='audio')||info.streams.some(stream=>stream.codec_type==='video')||(Number.isFinite(duration)&&(duration<0.1||duration>120.5)))throw Error('录音须为0.1至120秒的有效纯音频，请重新录制');
    // 浏览器录音可能没有容器时长；以完整解码后的PCM校验，并限制异常长输入的转换。
    ctx.signal.throwIfAborted();await runProcess(media.binaries().ffmpeg,['-v','error','-xerror','-y','-i',source,'-map','0:a:0','-vn','-t','120.6','-ac','1','-ar','24000','-c:a','pcm_s16le',output],{signal:ctx.signal});
    const result=await media.probe(output),actual=Number(result.format?.duration),audio=result.streams.find(stream=>stream.codec_type==='audio');
    if(!audio||!Number.isFinite(actual)||actual<0.1||actual>120.5||(Number.isFinite(duration)&&Math.abs(actual-duration)>0.25)||fs.statSync(output).size>maximumBytes)throw Error('录音转换校验失败，请重新录制');
    ctx.signal.throwIfAborted();created=store.addAsset(output,{origin:'microphone-recording',name:'声音录音-'+new Date().toISOString().replace(/[:.]/g,'-')+'.wav',duration:actual,recording:{mimeType:type,sourceSha256:crypto.createHash('sha256').update(buffer).digest('hex'),outputSha256:crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex')}},{persist:false});store.save();return created;
   }catch(error){if(created){store.data.assets=store.data.assets.filter(asset=>asset.id!==created.id);fs.rmSync(created.path,{force:true});}throw error;}finally{fs.rmSync(directory,{recursive:true,force:true});}
  });
 }
}
module.exports={Recordings};
