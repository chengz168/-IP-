const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {runProcess}=require('./media.cjs');
const {validateReferenceDuration}=require('./reference-media-limits.cjs');
// 分离音画必须来自同次分享页，并核对真实时长；缺失已发现的音轨时不能降级成无声报告。
async function extractBrowserMedia({browser,session,parser,media,directory,shareText,preferVideo,allowSilentVideo,ctx}){
 const urls=[...new Set(session.mediaUrls.filter(url=>/media-audio|media-video|video_mp4/.test(url)))];
 if(!urls.length)return null;
 const audios=urls.filter(url=>/media-audio/.test(url)),videos=urls.filter(url=>/media-video|video_mp4/.test(url));
 const candidates=preferVideo&&videos.length?videos:urls.sort((a,b)=>Number(/media-audio/.test(b))-Number(/media-audio/.test(a)));
 let lastError;
 for(const url of candidates){const temporary=[],make=()=>{const file=path.join(directory,'.browser-media-'+crypto.randomUUID()+'.mp4');temporary.push(file);return file;};
  try{
   ctx.signal?.throwIfAborted();ctx.progress?.(15,'正在静默下载分享媒体');const file=make();await browser.downloadMedia(url,file,{signal:ctx.signal});
   const info=await media.probe(file),duration=validateReferenceDuration(info.format?.duration,'链接媒体');let input=file,paired=false;
   if(preferVideo&&info.streams.some(s=>s.codec_type==='video')&&!info.streams.some(s=>s.codec_type==='audio')&&audios.length){
    let pairError;
    for(const audioUrl of audios){try{
     ctx.signal?.throwIfAborted();ctx.progress?.(18,'正在静默补齐分离音轨');const audioFile=make();await browser.downloadMedia(audioUrl,audioFile,{signal:ctx.signal});const audioInfo=await media.probe(audioFile),audioDuration=validateReferenceDuration(audioInfo.format?.duration,'分享页音轨');
     if(!audioInfo.streams.some(s=>s.codec_type==='audio')||Math.abs(audioDuration-duration)>1)throw Error('分享页音画时长不一致，未拼接不匹配的媒体');
     input=make();await runProcess(media.binaries().ffmpeg,['-v','error','-n','-i',file,'-i',audioFile,'-map','0:v:0','-map','1:a:0','-c','copy','-movflags','+faststart',input],{signal:ctx.signal});
     const merged=await media.probe(input);if(!merged.streams.some(s=>s.codec_type==='video')||!merged.streams.some(s=>s.codec_type==='audio')||Math.abs(Number(merged.format?.duration)-duration)>1)throw Error('分享页分离音画合并校验失败');paired=true;break;
    }catch(error){pairError=error;ctx.signal?.throwIfAborted();}}
    if(!paired)throw pairError||Error('分享页独立音轨未能合并，未接受无声来源');
   }
   const result=await parser.extractDownloaded(input,shareText,ctx,{title:session.title,allowSilentVideo});
   if(paired)result.linkSource.streamAssembly={kind:'same-page-audio-video',durationVerified:true};
   return result;
  }catch(error){lastError=error;ctx.signal?.throwIfAborted();}
  finally{for(const file of temporary)fs.rmSync(file,{force:true});}
 }
 throw lastError||Error('分享页没有可用媒体');
}
module.exports={extractBrowserMedia};
