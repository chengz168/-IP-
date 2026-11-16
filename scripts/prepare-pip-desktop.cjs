const fs=require('node:fs');
const path=require('node:path');
const {createService}=require('../server/service.cjs');
async function main(){
  const root=path.resolve('evidence/validation/pip-desktop-workspace');if(fs.existsSync(path.join(root,'studio.json')))throw new Error('桌面验收数据已存在，不重复初始化');
  const service=createService(root),report=JSON.parse(fs.readFileSync('evidence/validation/pip-report.json','utf8')),settings=JSON.parse(fs.readFileSync('data/studio.json','utf8')).settings;
  await service.invoke('saveSettings',{outputDir:'',ffmpegPath:settings.ffmpegPath,ffprobePath:settings.ffprobePath,provider:{}});
  const source=service.store.addAsset(report.source,{name:'画中画验收主视频.mp4'});
  const red=service.store.addAsset(path.join(report.root,'画中画红色标记.png'),{name:'红色图片.png',category:'逐句验收'});
  const blue=service.store.addAsset(path.join(report.root,'画中画蓝色标记.png'),{name:'蓝色图片.png',category:'另一分类'});
  const video=service.store.addAsset(path.join(report.root,'画中画逐秒变色视频.mp4'),{name:'变色动态视频.mp4',category:'逐句验收'});
  service.store.data.categories.push('逐句验收','另一分类');
  const srt=path.join(root,'逐句画中画字幕.srt');fs.writeFileSync(srt,'1\n00:00:01,000 --> 00:00:02,000\n第一句图片\n\n2\n00:00:02,000 --> 00:00:03,000\n相邻第二句\n\n3\n00:00:03,500 --> 00:00:04,500\n第三句保留主画面\n\n4\n00:00:05,000 --> 00:00:06,000\n第四句动态\n\n5\n00:00:06,000 --> 00:00:07,500\n最后一句图片');
  const caption=service.store.addAsset(srt);const d=service.store.draft();d.title='桌面功能验收 · 逐句画中画';d.step=4;d.edit.pipMode='captions';d.edit.pipSize=.4;d.edit.pipPosition='top-right';d.edit.subtitlesEnabled=false;service.store.save();
  const manifest={root,draftId:d.id,sourceId:source.id,redId:red.id,blueId:blue.id,videoId:video.id,captionId:caption.id,localFile:path.join(report.root,'画中画蓝色标记.png')};
  fs.writeFileSync('evidence/validation/pip-desktop-manifest.json',JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
