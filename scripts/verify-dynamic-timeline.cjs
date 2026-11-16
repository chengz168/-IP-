const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createService}=require('../server/service.cjs');
const {runProcess}=require('../server/media.cjs');
async function main(){
  const root=path.resolve('evidence/validation/dynamic-subtitles/timeline');fs.mkdirSync(root,{recursive:true});const service=createService(path.join(root,'workspace')),store=service.store;
  const baseline=JSON.parse(fs.readFileSync('evidence/validation/dynamic-subtitles/original-desktop-baseline.json')),original=baseline.drafts.find(d=>d.id===baseline.currentId),source=baseline.assets.find(a=>a.id===(original.edit.sourceId||original.video.assetId));assert.ok(source);
  Object.assign(store.data.settings,{ffmpegPath:baseline.settings.ffmpegPath,ffprobePath:baseline.settings.ffprobePath,subtitleFontsDir:'F:/Software/轻语IP智能体/aigc-human/resources/fonts'});
  const asset=store.addAsset(source.path),draft=store.draft();Object.assign(draft.edit,{sourceId:asset.id,speed:1.25,cutSilence:true,subtitlesEnabled:true,subtitleMode:'template',subtitleTemplate:'white_pinyin',subtitleKeywords:false,captions:[{start:0,end:2,text:'认真做好每一步'},{start:3,end:5,text:'从重要的事情开始'},{start:6,end:7.5,text:'现在一起开始吧'}]});store.save();
  const result=await service.invoke('render',{id:draft.id});assert.ok(result.timeline.removedDuration>0);assert.equal(result.timeline.speed,1.25);assert.ok(result.renderedCaptions.every(row=>row.end<=result.duration+.08));assert.equal(result.renderedSubtitleTemplate.pinyin.length,result.renderedCaptions.length);assert.ok(Math.abs(result.duration-result.timeline.duration/1.25)<.08);
  const file=path.join(root,'frame.png');await runProcess(service.media.binaries().ffmpeg,['-y','-v','error','-ss','0.8','-i',result.path,'-frames:v','1','-update','1',file]);
  const report={checkedAt:new Date().toISOString(),source:source.path,result,frame:file,assertions:['真实音轨检测和裁静音后，白色注音模板及所有逐字注音保持与裁切后的字幕对应','1.25倍速后真实媒体时长与全部字幕时间符合重映射结果']};fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
