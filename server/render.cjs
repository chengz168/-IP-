const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {detectSilence,remapCaptions}=require('./silence.cjs');
const {preparePip,appendPipInputs,appendPipFilters}=require('./pip.cjs');

async function render(media,draft,ctx,{runProcess,toAss,filterPath,wrapTitle}){
  const edit=draft.edit,store=media.store,source=store.asset(edit.sourceId||draft.video.assetId),info=await media.probe(source.path);
  const stream=info.streams.find(s=>s.codec_type==='video');if(!stream)throw new Error('请选择包含视频画面的文件');
  const sourceDuration=Number(info.format.duration);if(!Number.isFinite(sourceDuration)||sourceDuration<=0)throw new Error('无法确定视频时长');
  if(edit.subtitlesEnabled&&!edit.captions.length)throw new Error('字幕已开启，请先生成或导入并确认字幕，或关闭字幕');
  const speed=Number(edit.speed),volume=Number(edit.volume);
  if(!Number.isFinite(speed)||!Number.isFinite(volume)||speed<.5||speed>2||volume<0||volume>3)throw new Error('音视频参数超出范围');
  if(edit.captions.some(r=>!Number.isFinite(r.start)||!Number.isFinite(r.end)||r.start<0||r.end<=r.start||!String(r.text).trim()))throw new Error('字幕时间或内容无效，请检查后重试');
  const hasAudio=info.streams.some(s=>s.codec_type==='audio');
  const timeline=edit.cutSilence?await detectSilence(media,source.id,edit,ctx,runProcess):{sourceDuration,duration:sourceDuration,removedDuration:0,keep:[{start:0,end:sourceDuration}],removed:[]};
  ctx.progress?.(5,edit.cutSilence?'检测完成，实际裁掉静音约'+timeline.removedDuration.toFixed(2)+'秒':'已读取源视频');
  const duration=timeline.duration/speed,captions=edit.cutSilence?remapCaptions(edit.captions,timeline.keep):edit.captions;
  const pipPlan=await preparePip(media,edit,sourceDuration,timeline.keep,stream),pip=pipPlan.clips.length>0,pipHeight=pipPlan.height,pipSize=Number(edit.pipSize??.35);
  const tempDir=path.join(store.outputDir(),'.render-'+crypto.randomUUID());fs.mkdirSync(tempDir,{recursive:true});
  const target=path.join(store.outputDir(),'edited-'+crypto.randomUUID()+'.mp4');let moved=false,renderedSubtitleTemplate,renderedTitle,renderedNamecard,titleIndex=-1,cardIndex=-1;
  try{
    const temp=path.join(tempDir,'render.mp4'),args=['-y','-i',source.path];let index=1,bgmIndex=-1,sfxIndex=-1;
    if(edit.bgmEnabled){const asset=store.asset(edit.bgmId);if(!['audio','video'].includes(asset.type))throw new Error('背景音乐请选择音频或带音轨的视频');bgmIndex=index++;args.push('-stream_loop','-1','-i',asset.path);}
    index=appendPipInputs(pipPlan,args,index);
    if(edit.sfxEnabled){sfxIndex=index++;args.push('-i',store.asset(edit.sfxId).path);}
    if(edit.titleEnabled&&edit.titleDesign&&(edit.title.trim()||edit.subtitle?.trim())){
      if(!media.renderTitle)throw new Error('当前环境没有标题绘制服务，请在桌面应用中剪辑');
      const {titleSnapshot}=await import('./title-model.mjs'),snapshot=titleSnapshot(edit,Math.floor(Number(stream.width)/2)*2,Math.floor(Number(stream.height)/2)*2),image=await media.renderTitle(snapshot,ctx);
      ctx.signal?.throwIfAborted();if(!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image?.data||''))throw new Error('标题图层未生成有效PNG');
      const png=Buffer.from(image.data.split(',')[1],'base64');if(png.length<100||png.length>50000000||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||png.readUInt32BE(16)!==snapshot.width||png.readUInt32BE(20)!==snapshot.height)throw new Error('标题图层尺寸或文件无效');
      const file=path.join(tempDir,'title.png');fs.writeFileSync(file,png);titleIndex=index++;args.push('-loop','1','-i',file);renderedTitle={...snapshot,bounds:image.bounds,start:0,end:snapshot.design.displayMode==='seconds'?Math.min(duration,snapshot.design.duration):duration};
    }
    if(edit.cardEnabled){
      if(!media.renderNamecard)throw new Error('当前环境没有名片绘制服务，请在桌面应用中剪辑');
      const {namecardSnapshot}=await import('./namecard-model.mjs'),snapshot=namecardSnapshot(edit,Math.floor(Number(stream.width)/2)*2,Math.floor(Number(stream.height)/2)*2),image=await media.renderNamecard(snapshot,ctx);
      ctx.signal?.throwIfAborted();if(!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image?.data||''))throw new Error('名片图层未生成有效PNG');
      const png=Buffer.from(image.data.split(',')[1],'base64');if(png.length<100||png.length>50000000||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||png.readUInt32BE(16)!==snapshot.width||png.readUInt32BE(20)!==snapshot.height)throw new Error('名片图层尺寸或文件无效');
      const file=path.join(tempDir,'namecard.png');fs.writeFileSync(file,png);cardIndex=index++;args.push('-loop','1','-i',file);renderedNamecard={...snapshot,bounds:image.bounds,start:0,end:snapshot.design.displayMode==='duration'?Math.min(duration,snapshot.design.duration):duration};
    }
    const filters=[];let inputVideo='0:v',inputAudio='0:a';
    if(edit.cutSilence&&timeline.removedDuration>.001){
      const count=timeline.keep.length;
      if(count>1){filters.push(`[0:v]split=${count}`+timeline.keep.map((_,i)=>`[vs${i}]`).join(''));filters.push(`[0:a]asplit=${count}`+timeline.keep.map((_,i)=>`[as${i}]`).join(''));}
      timeline.keep.forEach((interval,i)=>{const v=count>1?'vs'+i:'0:v',a=count>1?'as'+i:'0:a';filters.push(`[${v}]trim=start=${interval.start}:end=${interval.end},setpts=PTS-STARTPTS[vc${i}]`);filters.push(`[${a}]atrim=start=${interval.start}:end=${interval.end},asetpts=PTS-STARTPTS[ac${i}]`);});
      filters.push(timeline.keep.map((_,i)=>`[vc${i}][ac${i}]`).join('')+`concat=n=${count}:v=1:a=1[cutv][cuta]`);inputVideo='cutv';inputAudio='cuta';
    }
    let vf=`[${inputVideo}]setpts=(PTS-STARTPTS)/${speed},scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1`;
    if(edit.subtitlesEnabled){
      const ass=path.join(tempDir,'captions.ass');let fontsOption='';
      if(edit.subtitleMode==='template'){
        const result=await require('./template-subtitles.cjs').toTemplateAss(captions,Number(stream.width),Number(stream.height),edit,store,{speed,signal:ctx.signal});
        const fontsDir=path.join(tempDir,'fonts');fs.mkdirSync(fontsDir);fs.copyFileSync(result.font.file,path.join(fontsDir,path.basename(result.font.file)));
        fs.writeFileSync(ass,result.ass);renderedSubtitleTemplate=result.metadata;
        fontsOption=":fontsdir='"+filterPath(fontsDir)+"'";
      }else if(edit.subtitleCustom){
        const {validateSubtitleStyle}=await import('./subtitle-style.mjs'),style=validateSubtitleStyle(edit.subtitleCustom);
        const {SubtitleFonts}=require('./subtitle-fonts.cjs'),font=new SubtitleFonts(store).resolve(style);
        const fontsDir=path.join(tempDir,'fonts');fs.mkdirSync(fontsDir);fs.copyFileSync(font.file,path.join(fontsDir,path.basename(font.file)));
        fs.writeFileSync(ass,await require('./custom-subtitles.cjs').toCustomAss(captions,Number(stream.width),Number(stream.height),style,{speed}));
        fontsOption=":fontsdir='"+filterPath(fontsDir)+"'";
      }else{
        const baseMargin=Number(stream.height)*Number(edit.subtitleMargin??.055);
        const marginV=pip&&edit.pipPosition!=='top-right'&&(!edit.subtitlePosition||edit.subtitlePosition==='bottom')?Math.max(pipHeight+70,baseMargin):baseMargin;
        fs.writeFileSync(ass,toAss(captions,Number(stream.width),Number(stream.height),{speed,marginV,fontSize:edit.subtitleFontSize,style:edit.subtitleStyle,position:edit.subtitlePosition,maxChars:edit.subtitleMaxChars}));
      }
      vf+=",subtitles=filename='"+filterPath(ass)+"'"+fontsOption;
    }
    const font=path.join(process.env.WINDIR||'C:/Windows','Fonts','msyh.ttc');
    if(edit.titleEnabled&&!edit.titleDesign&&edit.title.trim()){
      const fontSize=Math.round(Math.min(Number(stream.height)/18,Number(stream.width)/14)),rows=wrapTitle(edit.title,Number(stream.width)*.86/fontSize);if(rows.length>6)throw new Error('标题过长，请精简为6行以内');
      rows.forEach((row,i)=>{const file=path.join(tempDir,'title-'+i+'.txt');fs.writeFileSync(file,row);vf+=",drawtext=fontfile='"+filterPath(font)+"':textfile='"+filterPath(file)+"':expansion=none:fontsize="+fontSize+":fontcolor="+(edit.titleStyle==='white'?'white':'yellow')+":borderw=2:bordercolor=black:x=(w-text_w)/2:y=h*0.10+"+i*fontSize*1.35;});
    }
    filters.push(vf+'[base]');let video=appendPipFilters(pipPlan,filters,'base');
    if(titleIndex>=0){filters.push(`[${video}][${titleIndex}:v]overlay=0:0:enable='gte(t,0)*lt(t,${renderedTitle.end})':eof_action=repeat[titled]`);video='titled';}
    if(cardIndex>=0){filters.push(`[${video}][${cardIndex}:v]overlay=0:0:enable='gte(t,0)*lt(t,${renderedNamecard.end})':eof_action=repeat[carded]`);video='carded';}
    let audio='';
    // 原速时跳过变速滤镜，避免不必要的波形变化；显式变速保留原处理。
    if(hasAudio){filters.push(`[${inputAudio}]asetpts=PTS-STARTPTS${speed===1?'':`,atempo=${speed}`},volume=${volume}[voice]`);audio='voice';}
    if(bgmIndex>=0){const bgmVolume=Number(edit.bgmVolume);if(!Number.isFinite(bgmVolume)||bgmVolume<0||bgmVolume>1)throw new Error('背景音量需在0至1之间');filters.push(`[${bgmIndex}:a]volume=${bgmVolume}[bgm]`);if(audio){filters.push(`[${audio}][bgm]amix=inputs=2:duration=first:normalize=0[musicmix]`);audio='musicmix';}else audio='bgm';}
    if(sfxIndex>=0){if(audio){filters.push(`[${audio}][${sfxIndex}:a]amix=inputs=2:duration=first:normalize=0[sfxmix]`);audio='sfxmix';}else audio=sfxIndex+':a';}
    const graph=path.join(tempDir,'filters.txt');fs.writeFileSync(graph,filters.join(';'));
    args.push('-filter_complex_script',graph,'-map','['+video+']');if(audio)args.push('-map',audio.includes(':')?audio:'['+audio+']','-c:a','aac','-b:a','192k');else args.push('-an');
    args.push('-t',String(duration),'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart','-progress','pipe:1','-nostats',temp);
    await runProcess(media.binaries().ffmpeg,args,{signal:ctx.signal,onProgress:text=>{const matches=[...text.matchAll(/out_time_us=(\d+)/g)];if(matches.length)ctx.progress?.(5+Number(matches.at(-1)[1])/1e6/duration*90);}});
    const result=await media.probe(temp),actualDuration=Number(result.format.duration);
    if(!result.streams.some(s=>s.codec_type==='video')||fs.statSync(temp).size<1000||!Number.isFinite(actualDuration)||Math.abs(actualDuration-duration)>Math.max(.25,duration*.01))throw new Error('生成文件未通过媒体时长或画面校验');
    fs.renameSync(temp,target);moved=true;
    return store.addAsset(target,{name:path.basename(target),origin:'render',duration:actualDuration,timeline:{...timeline,speed},renderedPip:pipPlan.clips,...(renderedTitle?{renderedTitle}:{}),...(renderedNamecard?{renderedNamecard}:{}),...(renderedSubtitleTemplate?{renderedSubtitleTemplate}:{}),renderedCaptions:captions.map(r=>({...r,start:r.start/speed,end:r.end/speed}))});
  }catch(error){if(moved)fs.rmSync(target,{force:true});throw error;}finally{fs.rmSync(tempDir,{recursive:true,force:true});}
}
module.exports={render};
