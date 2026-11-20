const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {runProcess}=require('./media.cjs');
const filterPath=value=>value.replace(/\\/g,'/').replace(/:/g,'\\:').replace(/'/g,"'\\''");
const normalizedFont=value=>path.resolve(value.replace(/\\/g,'/')).replace(/\\/g,'/').toLowerCase();
function verifyFontLog(log,font){
 // 显式fontfile正常打开时不会输出Using；若出现该行，只允许仍使用已选字体。
 for(const match of log.matchAll(/\bUsing\s+"([^"\r\n]+)"/g))if(normalizedFont(match[1])!==normalizedFont(font))throw Error('商品文字字体加载失败并尝试替换字体，已停止合成，请检查字体路径');
 if(/Fontconfig error:|Could not load font|Could not (?:set font size|open|load).*font|Failed to (?:load|open).*font|cannot open resource/i.test(log))throw Error('商品文字字体预检失败，已停止合成，请检查本地字体');
}
async function prepareDrawtextFont(source,ffmpeg,ctx={}){
 if(!source||!fs.existsSync(source)||!fs.statSync(source).isFile())throw Error('商品卖点叠加缺少可读取的中文字体');
 let temporary='',font=path.resolve(source);const sourceHash=crypto.createHash('sha256').update(fs.readFileSync(font)).digest('hex');
 try{
  // 本机FreeType无法可靠打开中文路径；系统ASCII路径直接使用，其他字体只复制到ASCII临时目录。
  if(/[^\x20-\x7e]/.test(font)){
   for(const candidate of new Set([os.tmpdir(),process.env.TEMP,process.env.TMP,process.env.PUBLIC].filter(Boolean))){const root=path.resolve(candidate);if(/[^\x20-\x7e]/.test(root)||!fs.existsSync(root))continue;try{temporary=fs.mkdtempSync(path.join(root,'superip-product-font-'));break;}catch{}}
   if(!temporary)throw Error('未找到可写的ASCII临时目录，无法安全加载商品中文字体');
   const copied=path.join(temporary,'font'+path.extname(font).toLowerCase());fs.copyFileSync(font,copied);font=copied;
   if(crypto.createHash('sha256').update(fs.readFileSync(font)).digest('hex')!==sourceHash)throw Error('商品字体复制校验失败，未开始合成');
  }
  let diagnostics='';await runProcess(ffmpeg,['-hide_banner','-loglevel','verbose','-f','lavfi','-i','color=c=black:s=320x120:r=1','-vf',`drawtext=fontfile='${filterPath(font)}':text='商品介绍羽毛铃铛':fontsize=28:fontcolor=white:x=10:y=10`,'-frames:v','1','-f','null','-'],{signal:ctx.signal,onStderr:chunk=>{diagnostics=(diagnostics+chunk).slice(-64000);}});
  verifyFontLog(diagnostics,font);return {file:font,sha256:sourceHash,cleanup(){if(temporary)fs.rmSync(temporary,{recursive:true,force:true});}};
 }catch(error){if(temporary)fs.rmSync(temporary,{recursive:true,force:true});throw error;}
}
function wrap(text,limit){const rows=[];let row='',units=0;for(const ch of String(text)){if(ch==='\n'||units+(/[^\x00-\x7f]/.test(ch)?1:.6)>limit){if(row)rows.push(row);row='';units=0;if(ch==='\n')continue;}row+=ch;units+=/[^\x00-\x7f]/.test(ch)?1:.6;}if(row)rows.push(row);return rows;}
// 商品文字只从确认的卖点字段读取，图标只读取绑定的原素材；不让模型绘制参数。
async function composeProductIntroduction(generator,input,parts,narration,directory,ctx,hash){
 if(!narration)throw Error('产品介绍合成必须使用第三步对应旁白，请先生成声音');
 const {canvas}=require('./story-generator.cjs'),[width,height]=canvas(input.aspect,true),args=['-hide_banner','-loglevel','verbose','-y'],filters=[],streams=[],icons=[],overlays=[];
 parts.forEach(part=>args.push('-i',part.path));const narrationIndex=parts.length;args.push('-i',narration.path);const narrationSha256=hash(narration.path);
 if(input.productIntroduction.audioSha256&&narrationSha256!==input.productIntroduction.audioSha256)throw Error('合成旁白与第三步确认音频内容不一致，未登记成片');
 const trustedIcons=require('./story-contract.cjs').frozenProductIcons(input.productIntroduction);
 let nextInput=narrationIndex+1,needsFont=false;
 for(const [index,part] of parts.entries()){
  if(part.sellingPoint!==undefined&&typeof part.sellingPoint!=='string')throw Error('商品镜头卖点文本格式无效');
  const sellingPoint=(part.sellingPoint||'').trim();if(sellingPoint.length>160||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(sellingPoint))throw Error('商品镜头卖点过长或包含无效字符');
  if(part.iconIds!==undefined&&(!Array.isArray(part.iconIds)||part.iconIds.length>4||new Set(part.iconIds).size!==part.iconIds.length))throw Error('每镜最多绑定四个不同的原图标');
  const references=[];
  for(const id of part.iconIds||[]){if(!trustedIcons.has(id))throw Error('商品图标必须属于冻结来源清单中原角色为图标的素材');const asset=generator.store.asset(id),expectedSha256=trustedIcons.get(id);if(asset.type!=='image')throw Error('商品图标必须为已导入图片');if(hash(asset.path)!==expectedSha256)throw Error('商品图标内容与冻结来源不一致，请重新准备产品介绍分镜');const info=await generator.probe(asset.path,ctx),stream=info.streams.find(row=>row.codec_type==='video');if(!stream||stream.width<1||stream.height<1||stream.width*stream.height>33554432)throw Error('商品图标图片尺寸无效');const frozenFile=path.join(directory,`icon-${index}-${references.length}${path.extname(asset.path)||'.img'}`);fs.copyFileSync(asset.path,frozenFile);if(hash(frozenFile)!==expectedSha256)throw Error('商品图标复制期间已变化，未开始合成');const ref={assetId:id,path:asset.path,sha256:expectedSha256,input:nextInput++};args.push('-loop','1','-framerate','24','-i',frozenFile);references.push(ref);icons.push(ref);}
  overlays.push({shotId:part.shotId,sellingPoint,iconIds:references.map(row=>row.assetId)});needsFont||=!!sellingPoint;
  filters.push(`[${index}:v]trim=duration=${part.duration},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=24,setsar=1,format=yuv420p[base${index}]`);
  let previous='base'+index;
  for(const [position,ref] of references.entries()){
   const size=Math.round(Math.min(width*.14,height*.12)/2)*2,label=`icon${index}_${position}`,output=`withicon${index}_${position}`,margin=Math.round(width*.06),x=margin+position*(size+margin),y=Math.round(height*.68);
   filters.push(`[${ref.input}:v]scale=${size}:${size}:force_original_aspect_ratio=decrease,format=rgba,fade=t=in:st=0:d=${Math.min(.18,part.duration/2)}:alpha=1[${label}]`);
   filters.push(`[${previous}][${label}]overlay=x=${x}:y='${y}+12*max(0,1-t/0.2)':shortest=1[${output}]`);previous=output;
  }
  part._productOverlayBase=previous;
 }
 let font,preparedFont;
 try{
 if(needsFont){const preferred=path.join(process.env.WINDIR||'C:/Windows','Fonts','msyh.ttc');font=fs.existsSync(preferred)?preferred:new (require('./subtitle-fonts.cjs').SubtitleFonts)(generator.store).catalog().find(row=>/YaHei|黑体|宋体|Noto.*CJK/i.test(row.family))?.file;if(!font)throw Error('商品卖点叠加缺少中文字体，请配置本地字体目录');preparedFont=await prepareDrawtextFont(font,generator.media.binaries().ffmpeg,ctx);font=preparedFont.file;}
 for(const [index,part] of parts.entries()){
  let previous=part._productOverlayBase;const sellingPoint=overlays[index].sellingPoint;
  if(sellingPoint){const fontSize=Math.round(Math.min(width/17,height/22)),rows=wrap(sellingPoint,width*.84/fontSize);if(rows.length>4)throw Error('商品镜头卖点超过四行，请精简后合成');const file=path.join(directory,`selling-point-${index}.txt`);fs.writeFileSync(file,rows.join('\n'));const label='titled'+index;filters.push(`[${previous}]drawtext=fontfile='${filterPath(font)}':textfile='${filterPath(file)}':expansion=none:fontsize=${fontSize}:fontcolor=white:line_spacing=${Math.round(fontSize*.3)}:borderw=2:bordercolor=black@0.75:box=1:boxcolor=black@0.35:boxborderw=12:x=(w-text_w)/2:y=h*0.1:alpha='min(1,t/0.16)'[${label}]`);previous=label;}
  streams.push(`[${previous}]`);delete part._productOverlayBase;
 }
 const visualDuration=parts.reduce((sum,part)=>sum+part.duration,0),narrationInfo=await generator.probe(narration.path,ctx),total=Number(narrationInfo.format?.duration);if(!Number.isFinite(total)||total<=0||total>visualDuration+.001)throw Error('商品镜头未覆盖完整旁白，请按真实声音时间轴重新准备分镜');filters.push(`${streams.join('')}concat=n=${parts.length}:v=1:a=0[outv]`);filters.push(`[${narrationIndex}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[outa]`);
 const graph=path.join(directory,'product-filters.txt'),output=path.join(directory,'product-introduction.mp4');fs.writeFileSync(graph,filters.join(';'));args.push('-filter_complex_script',graph,'-map','[outv]','-map','[outa]','-t',String(total),'-c:v','libx264','-preset','veryfast','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',output);
 let fontDiagnostics='';await runProcess(generator.media.binaries().ffmpeg,args,{signal:ctx.signal,onStderr:chunk=>{fontDiagnostics=(fontDiagnostics+chunk).slice(-64000);}});if(preparedFont)verifyFontLog(fontDiagnostics,font);for(const item of [...parts,...icons,{path:narration.path,sha256:narrationSha256}])if(hash(item.path)!==item.sha256)throw Error('合成期间商品视频、图标或旁白已变化，未登记结果');
 return {file:output,total,details:{protocol:'local-ffmpeg-product-introduction',model:'FFmpeg',productIntroduction:input.productIntroduction,shots:parts.map(({path,...part})=>part),narrationAssetId:narration.id,narrationSha256,visualDuration,audioPolicy:'matched-step-three-narration-only',overlayPolicy:'confirmed-selling-point-text-and-bound-original-icons',overlays,icons:icons.map(({path,input,...icon})=>icon),qualityAccepted:false}};
 }finally{preparedFont?.cleanup();}
}
module.exports={composeProductIntroduction,prepareDrawtextFont,verifyFontLog};
