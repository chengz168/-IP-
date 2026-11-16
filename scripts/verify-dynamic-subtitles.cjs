const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createService}=require('../server/service.cjs');
const {runProcess}=require('../server/media.cjs');
const {toTemplateAss}=require('../server/template-subtitles.cjs');
async function main(){
  const root=path.resolve('evidence/validation/dynamic-subtitles/media');fs.mkdirSync(root,{recursive:true});
  const service=createService(path.join(root,'workspace')),store=service.store;
  const settings=JSON.parse(fs.readFileSync('evidence/validation/pip-desktop-workspace/studio.json')).settings;
  Object.assign(store.data.settings,{ffmpegPath:settings.ffmpegPath,ffprobePath:settings.ffprobePath,subtitleFontsDir:'F:/Software/轻语IP智能体/aigc-human/resources/fonts'});store.save();
  const {subtitleTemplates}=await import('../server/subtitle-templates.mjs'),ffmpeg=service.media.binaries().ffmpeg,source=path.join(root,'source.mp4');
  await runProcess(ffmpeg,['-y','-v','error','-loop','1','-i',path.resolve('server/assets/subtitle-portrait.png'),'-vf','scale=540:960','-t','4.8','-r','25','-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p',source]);
  const asset=store.addAsset(source),draft=store.draft();
  const texts=['认真做好每一步','从重要的事情开始','用心记录每一天','现在一起开始吧'];
  const translations=['Make every step count.','Start with what matters.','Record each day with care.','Let us begin together.'];
  const rows=texts.map((text,index)=>({start:index*1.2,end:(index+1)*1.2,text,auxiliary:{sourceText:text,translation:translations[index],keywords:[text.slice(0,2)]}}));
  Object.assign(draft.edit,{sourceId:asset.id,subtitlesEnabled:true,subtitleMode:'template',captions:rows,subtitleKeywords:true});
  const report={checkedAt:new Date().toISOString(),templates:[],assertions:[],limits:['尚未逐模板与原软件同源成片比较，不表示动画时序或像素一致']};
  for(const template of subtitleTemplates){
    draft.edit.subtitleTemplate=template.id;delete draft.edit.subtitleTemplateY;store.save();
    const result=await service.invoke('render',{id:draft.id});assert.equal(result.renderedSubtitleTemplate.templateId,template.id);assert.ok(Math.abs(result.duration-4.8)<.08);
    const ass=await toTemplateAss(rows,540,960,draft.edit,store);fs.writeFileSync(path.join(root,template.id+'.ass'),ass.ass);
    const frames=[];for(const stamp of [.08,.6,1.45]){const file=path.join(root,template.id+'-'+stamp+'.png');await runProcess(ffmpeg,['-y','-v','error','-ss',String(stamp),'-i',result.path,'-frames:v','1','-update','1',file]);frames.push(file);}
    const preview=await service.invoke('previewSubtitleTemplate',{templateId:template.id});assert.ok(preview.dataUrl.startsWith('data:image/gif;base64,'));const gif=path.join(root,template.id+'.gif');fs.writeFileSync(gif,Buffer.from(preview.dataUrl.split(',')[1],'base64'));
    const cached=await service.invoke('previewSubtitleTemplate',{templateId:template.id});assert.equal(cached.cached,true);
    const info=await service.media.probe(gif);assert.equal(Number(info.streams[0].width),268);assert.ok(Number(info.streams[0].nb_frames)>1);
    report.templates.push({id:template.id,name:template.name,result,frames,gif,gifFrames:Number(info.streams[0].nb_frames)});
    console.log(JSON.stringify({template:template.name,path:result.path,font:result.renderedSubtitleTemplate.font.label,frames:Number(info.streams[0].nb_frames)}));
  }
  report.assertions.push('22项均经正式剪辑生成可解码4.8秒视频，逐项保留3帧、实际字体和ASS','22项同引擎本地GIF真实多帧，第二次读取命中缓存');
  draft.edit.subtitleTemplate='white_pinyin';draft.edit.subtitleKeywords=false;store.save();const phonetic=await toTemplateAss(rows,540,960,draft.edit,store);assert.ok(phonetic.metadata.pinyin.every((tokens,index)=>tokens.length===Array.from(rows[index].text).length));assert.equal(phonetic.metadata.pinyin[0][0],'rèn');report.assertions.push('pypinyin真实逐字注音，首字认真对应rèn');
  draft.edit.subtitleTemplate='yellow_white_bilingual';draft.edit.captions=[{start:0,end:1,text:'缺失译文'}];await assert.rejects(service.invoke('render',{id:draft.id}),/缺少与当前原文/);draft.edit.captions=rows;draft.edit.subtitleTemplate='3d_flip';draft.edit.subtitleKeywords=true;draft.edit.captions[0]={...rows[0],auxiliary:{...rows[0].auxiliary,sourceText:'已过期'}};await assert.rejects(service.invoke('render',{id:draft.id}),/当前原文/);draft.edit.captions=rows.map(row=>({...row}));
  const fontRoot=store.data.settings.subtitleFontsDir;store.data.settings.subtitleFontsDir='';draft.edit.subtitleTemplate='variety_wave';await assert.rejects(service.invoke('render',{id:draft.id}),/缺少小石头体/);store.data.settings.subtitleFontsDir=fontRoot;draft.edit.subtitlesEnabled=false;const disabled=await service.invoke('render',{id:draft.id});assert.ok(disabled.size>1000);draft.edit.subtitlesEnabled=true;
  report.assertions.push('缺译文、过期辅助文本、缺模板字体明确失败，关闭字幕可沿用视频不读取模板');
  const controller=new AbortController();controller.abort();await assert.rejects(toTemplateAss(rows,540,960,{subtitleTemplate:'white_pinyin',subtitleKeywords:false},store,{signal:controller.signal}));
  report.assertions.push('取消信号阻止注音处理');assert.deepEqual(fs.readdirSync(store.outputDir()).filter(name=>name.startsWith('.render-')),[]);
  fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({report:path.join(root,'report.json'),assertions:report.assertions}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
