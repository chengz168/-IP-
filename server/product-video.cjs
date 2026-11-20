const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {runProcess}=require('./media.cjs');
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sizes={'9:16':[1080,1920],'16:9':[1920,1080],'1:1':[1080,1080]};
function timedShots(shots,duration){
 const frames=Math.ceil(duration*25),weight=shots.reduce((sum,shot)=>sum+shot.duration,0);if(frames<shots.length)throw Error('配音过短，无法覆盖当前商品镜头');let used=0,cumulative=0;
 return shots.map((shot,index)=>{cumulative+=shot.duration;const end=index===shots.length-1?frames:Math.max(used+1,Math.min(frames-(shots.length-index-1),Math.round(frames*cumulative/weight))),start=used/25;used=end;return {...shot,start,end:end/25,duration:end/25-start};});
}
async function renderProductVideo(service,{draft,shots,aspect,narration,audioId},ctx){
 const {store,media,providers}=service,[width,height]=sizes[aspect],dir=fs.mkdtempSync(path.join(store.outputDir(),'.product-render-')),clips=[];let timed,captions=[],baseAsset,recognition,proofreading;
 try{
  let duration=shots.reduce((sum,shot)=>sum+shot.duration,0),audio;
  if(narration){
   audio=store.asset(audioId);const info=await media.probe(audio.path);duration=Number(info.format.duration);if(audio.type!=='audio'||!info.streams.some(s=>s.codec_type==='audio')||!Number.isFinite(duration)||duration<=0)throw Error('第三步配音没有有效音轨，请重新生成声音');
   ctx.progress(5,'正在识别第三步配音，保留原始声音与真实字幕时间轴');recognition=await providers.transcribe(audioId,ctx);
   const {recognitionRows,recognitionOptions}=await import('./caption-recognition.mjs');
   try{({captions,proofreading}=require('./product-captions.cjs').productCaptions(recognitionRows(recognition,duration,recognitionOptions(draft.edit)),draft.finalText));}catch(error){error.evidence={recognition,referenceText:draft.finalText,audioId};throw error;}
  }
  timed=timedShots(shots,duration);const cursor=timed.at(-1).end;if(!narration)captions=timed.map(shot=>({start:shot.start,end:shot.end,text:shot.text}));
  for(let index=0;index<shots.length;index++){
   ctx.signal.throwIfAborted();const shot=timed[index],image=store.asset(shot.imageId),duration=shot.duration;
   const out=path.join(dir,'shot-'+index+'.mp4'),args=['-y','-loop','1','-framerate','25','-i',image.path];
   // 完整商品图置于模糊衬底上，保持比例和边距，不裁掉包装和标识。
   const fgWidth=Math.floor(width*.9/2)*2,fgHeight=Math.floor(height*.82/2)*2;
   // JPEG与WebP可能使用不同色域范围；先统一，避免后续字幕滤镜重建并重置时间轴。
   const filter=`[0:v]scale=in_range=auto:out_range=tv:out_color_matrix=bt709,format=yuv420p,setparams=range=limited:colorspace=bt709:color_primaries=bt709:color_trc=bt709,split=2[bg][fg];[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=24:2,eq=brightness=-0.13:saturation=0.65[back];[fg]scale=${fgWidth}:${fgHeight}:force_original_aspect_ratio=decrease[front];[back][front]overlay=x='(W-w)/2+8*sin(0.5*t)':y='(H-h)/2+10*sin(0.35*t)':eval=frame,setsar=1,format=yuv420p,fade=t=in:st=0:d=0.16,fade=t=out:st=${Math.max(0,duration-.16)}:d=0.16[v]`;
   args.push('-filter_complex',filter,'-map','[v]','-an','-t',String(duration),'-r','25','-c:v','libx264','-preset','veryfast','-crf','20','-threads','4','-color_range','tv','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-movflags','+faststart',out);
   ctx.progress(35+index/shots.length*49,'正在合成第'+(index+1)+'/'+shots.length+'商品镜头');await runProcess(media.binaries().ffmpeg,args,{signal:ctx.signal});clips.push(out);
  }
  const concat=path.join(dir,'concat.txt');fs.writeFileSync(concat,clips.map(file=>"file '"+path.basename(file)+"'").join('\n'));
  // 整段配音只合成一次，不逐镜切音频，也不重复调用配音模型。
  const joined=path.join(dir,'product.mp4'),joinArgs=['-y','-f','concat','-safe','0','-i',concat];if(audio)joinArgs.push('-i',audio.path);else joinArgs.push('-f','lavfi','-i','anullsrc=r=48000:cl=stereo');joinArgs.push('-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-ar','48000','-ac','2','-af','apad','-t',String(cursor),'-movflags','+faststart',joined);await runProcess(media.binaries().ffmpeg,joinArgs,{signal:ctx.signal});
  const info=await media.probe(joined),video=info.streams.find(s=>s.codec_type==='video'),actual=Number(info.format.duration);if(!video||video.width!==width||video.height!==height||!Number.isFinite(actual)||Math.abs(actual-cursor)>.35)throw Error('商品视频媒体校验失败：画幅或时长不一致');ctx.signal.throwIfAborted();
  baseAsset=store.addAsset(joined,{name:'商品宣传原片.mp4',origin:'product-video',duration:actual,productVideo:{aspect,narration,images:shots.map(s=>s.imageId),audioId:audio?.id||'',kind:'original-image-presentation'}});
  ctx.progress(90,'正在绘制字幕并校验商品视频');
  const editDraft=structuredClone(draft);editDraft.video.assetId=baseAsset.id;editDraft.edit={...editDraft.edit,sourceId:baseAsset.id,captions,subtitlesEnabled:!!captions.length,titleEnabled:false,cardEnabled:false,pipEnabled:false,bgmEnabled:false,sfxEnabled:false,cutSilence:false,speed:1,volume:1,resultId:''};
  const rendered=await media.render(editDraft,ctx),finalInfo=await media.probe(store.asset(rendered.id).path),finalVideo=finalInfo.streams.find(s=>s.codec_type==='video');if(!finalVideo||finalVideo.width!==width||finalVideo.height!==height||Math.abs(Number(finalInfo.format.duration)-actual)>.35)throw Error('商品字幕视频校验失败');
  ctx.signal.throwIfAborted();return {asset:rendered,baseAsset,audioId:audio?.id||'',shots:timed,captions,recognition,proofreading,duration:actual,outputSha256:sha(store.asset(rendered.id).path),baseSha256:sha(store.asset(baseAsset.id).path),method:'original-image-presentation',timingMethod:'planned-ratio-to-full-audio',warnings:['此版本使用已确认商品原图进行展示合成，未模拟实拍动作或产品使用效果。','镜头按计划比例覆盖完整配音；字幕使用实际识别时间轴，逐镜画面切换可在剪辑步骤核对。',...(proofreading?.changed?['字幕已依据确认稿校对，原始识别仍保留；请回听检查实际发音，字幕一致不代表配音逐字正确。']:[])]};
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
module.exports={renderProductVideo,timedShots};
