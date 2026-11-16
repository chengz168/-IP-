const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createService}=require('../server/service.cjs');
const {runProcess}=require('../server/media.cjs');
async function main(){
  const report=JSON.parse(fs.readFileSync('evidence/validation/pip-report.json','utf8')),root=fs.mkdtempSync(path.resolve('evidence/validation/pip-loop-')),service=createService(root),settings=JSON.parse(fs.readFileSync('data/studio.json','utf8')).settings;
  await service.invoke('saveSettings',{outputDir:'',ffmpegPath:settings.ffmpegPath,ffprobePath:settings.ffprobePath,provider:{}});
  const source=service.store.addAsset(report.source),marker=service.store.addAsset(path.join(report.root,'画中画逐秒变色视频.mp4')),d=service.store.draft();
  Object.assign(d.edit,{sourceId:source.id,pipEnabled:true,pipMode:'captions',pipPosition:'top-right',pipSize:.4,subtitlesEnabled:false,captions:[{start:.5,end:7.5,text:'短视频循环',pipId:marker.id}]});service.store.save();
  let n=0;async function sample(asset,time){const file=path.join(root,'pixel-'+n+++'.rgb');await runProcess(settings.ffmpegPath,['-y','-ss',String(time),'-i',asset.path,'-frames:v','1','-vf','crop=12:12:206:30,scale=1:1:flags=area','-pix_fmt','rgb24','-f','rawvideo',file]);return [...fs.readFileSync(file)];}
  const loop=await service.invoke('render',{id:d.id}),checks=[];
  for(const [time,expected] of [[6.2,[0,255,255]],[7.2,[255,0,0]]]){const actual=await sample(loop,time);assert.ok(actual.length===3&&actual.every((v,i)=>Math.abs(v-expected[i])<24));checks.push({time,actual,expected});}
  d.edit.captions=[{start:.5,end:1.8,text:'第一句从头',pipId:marker.id},{start:3,end:4.5,text:'第二句也从头',pipId:marker.id}];service.store.save();const restart=await service.invoke('render',{id:d.id}),actual=await sample(restart,3.2);assert.ok(actual[0]>230&&actual[1]<24&&actual[2]<24);checks.push({time:3.2,actual,expected:[255,0,0],case:'同一视频在下一字幕重新从头播放'});
  const result={checkedAt:new Date().toISOString(),loop,restart,checks,scope:'真实商品主画面，动态颜色验收素材；短视频循环与每句从头播放'};fs.writeFileSync('evidence/validation/pip-loop-report.json',JSON.stringify(result,null,2));console.log(JSON.stringify({report:'evidence/validation/pip-loop-report.json',checks},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
