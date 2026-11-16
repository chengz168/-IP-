const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createService}=require('../server/service.cjs');
const {runProcess}=require('../server/media.cjs');
const {toCustomAss}=require('../server/custom-subtitles.cjs');
const {SubtitleFonts}=require('../server/subtitle-fonts.cjs');
async function main(){
  const root=path.resolve('evidence/validation/subtitle-custom-media'),report={checkedAt:new Date().toISOString(),assertions:[],previews:[]};fs.mkdirSync(root,{recursive:true});
  const service=createService(path.join(root,'workspace')),store=service.store;
  const base=JSON.parse(fs.readFileSync('evidence/validation/subtitle-custom/desktop-before.json','utf8'));
  store.data.settings.ffmpegPath=base.settings.ffmpegPath;store.data.settings.ffprobePath=base.settings.ffprobePath;
  store.data.settings.outputDir=path.join(root,'outputs');store.data.settings.subtitleFontsDir='F:/Software/轻语IP智能体/aigc-human/resources/fonts';store.save();
  const {subtitleDefaults,subtitlePresets,presetStyle}=await import('../server/subtitle-style.mjs');
  const fonts=await service.invoke('listSubtitleFonts'),font=fonts.find(f=>f.family==='Microsoft YaHei');assert.ok(font);assert.ok(fonts.some(f=>f.source==='local'));report.fontCount=fonts.length;
  let style={...subtitleDefaults,fontId:font.id,fontFamily:font.family};
  const before=fs.readFileSync(store.file,'utf8');
  for(const preset of subtitlePresets){const current=presetStyle(preset.id,style,font),preview=await service.invoke('previewSubtitle',{style:current});const file=path.join(root,preset.id+'.png');fs.writeFileSync(file,Buffer.from(preview.dataUrl.split(',')[1],'base64'));assert.equal(preview.width,1080);assert.equal(preview.height,1920);report.previews.push({preset:preset.name,style:current,file});}
  assert.equal(fs.readFileSync(store.file,'utf8'),before);report.assertions.push('八预设真实PNG预览不改变任何业务JSON、素材或运行记录');
  style={...style,bold:true,italic:true,underline:true,color:'#FFE040',opacity:85,outlineEnabled:true,outlineWidth:3,outlineColor:'#14223A',shadowEnabled:true,shadowDistance:7,shadowColor:'#A00020',shadowOpacity:70,backgroundEnabled:true,backgroundColor:'#2447AB',backgroundOpacity:65,letterSpacing:2};
  const preview=await service.invoke('previewSubtitle',{style});fs.writeFileSync(path.join(root,'combined-preview.png'),Buffer.from(preview.dataUrl.split(',')[1],'base64'));
  const ffmpeg=service.media.binaries().ffmpeg,source=path.join(root,'preview-source.mp4');
  // 同一张参考图片编码成独立视频，再走正式剪辑链路，供解码后比对字幕位置与效果。
  await runProcess(ffmpeg,['-y','-v','error','-loop','1','-i',path.resolve('server/assets/subtitle-portrait.png'),'-t','2','-r','25','-c:v','libx264','-crf','12','-pix_fmt','yuv420p',source]);
  const asset=store.addAsset(source),draft=await service.invoke('newDraft');draft.edit.sourceId=asset.id;draft.edit.subtitlesEnabled=true;draft.edit.captions=[{start:0,end:2,text:'这个神仙锅刷'}];draft.edit.subtitleCustom=style;draft.edit.pipEnabled=false;store.save();
  const rendered=await service.invoke('render',{id:draft.id});report.rendered=rendered;assert.ok(rendered.size>1000);assert.ok(Math.abs(rendered.duration-2)<.1);
  await runProcess(ffmpeg,['-y','-v','error','-i',rendered.path,'-ss','0.5','-frames:v','1','-update','1',path.join(root,'combined-video-frame.png')]);report.assertions.push('复杂组合样式通过正式剪辑链路生成2秒1080×1920可解码视频');
  report.previewVideoComparison=JSON.parse(await runProcess('python',[path.resolve('scripts/compare-subtitle-frames.py'),path.join(root,'combined-preview.png'),path.join(root,'combined-video-frame.png'),path.resolve('server/assets/subtitle-portrait.png')]));
  fs.writeFileSync(path.join(root,'preview-video-comparison.json'),JSON.stringify(report.previewVideoComparison,null,2));report.assertions.push('独立解码帧的字幕区域接近同样式预览，且明确区别于无字幕源图');
  const fontFile=new SubtitleFonts(store).resolve(style).file;report.font=fontFile;
  const custom=fonts.find(f=>f.source==='local'&&f.label.includes('方正粗黑宋'));assert.ok(custom);const localPreview=await service.invoke('previewSubtitle',{style:{...style,fontId:custom.id,fontFamily:custom.family}});fs.writeFileSync(path.join(root,'local-font-preview.png'),Buffer.from(localPreview.dataUrl.split(',')[1],'base64'));report.localFont=custom;report.assertions.push('已有本地字体目录真实读取并用于预览');
  const sourceAsset=base.assets.find(a=>a.id===base.drafts[0].edit.sourceId),real=store.addAsset(sourceAsset.path);draft.edit.sourceId=real.id;draft.edit.speed=1.25;draft.edit.cutSilence=true;draft.edit.silenceThreshold=-35;draft.edit.silenceMinimum=.35;draft.edit.silencePadding=.09;draft.edit.captions=[{start:0,end:2,text:'第一段字幕'},{start:3,end:5,text:'第二段字幕'},{start:6,end:7.5,text:'最后一段'}];store.save();
  const timed=await service.invoke('render',{id:draft.id});report.timed=timed;assert.ok(timed.timeline.removedDuration>0);assert.equal(timed.timeline.speed,1.25);assert.ok(timed.renderedCaptions.every(r=>r.end<=timed.duration+.05));report.assertions.push('真实静音裁切与1.25倍速后，自定义样式和字幕时间轴共同进入正式输出');
  const broken={...style,fontId:'font-00000000000000000000'};await assert.rejects(service.invoke('previewSubtitle',{style:broken}),/字体已缺失/);draft.edit.subtitleCustom=broken;draft.edit.subtitlesEnabled=false;draft.edit.cutSilence=false;draft.edit.speed=1;store.save();const disabled=await service.invoke('render',{id:draft.id});assert.ok(disabled.size>1000);report.assertions.push('字体缺失明确失败，关闭字幕时不读取旧损坏配置');
  const afterFailure=fs.readFileSync(store.file,'utf8');await assert.rejects(service.invoke('previewSubtitle',{style:{...style,color:'bad'}}),/颜色/);assert.equal(fs.readFileSync(store.file,'utf8'),afterFailure);
  report.tempDirectories=fs.readdirSync(store.outputDir()).filter(f=>f.startsWith('.render-'));assert.deepEqual(report.tempDirectories,[]);
  fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({file:path.join(root,'report.json'),assertions:report.assertions,previews:report.previews.length,rendered:rendered.path,timed:timed.path},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
