const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const sharp=require('C:/Users/DELL/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const {Media,runProcess}=require('../server/media.cjs');
async function main(){
 const root=path.resolve('evidence/validation/subtitle-template-runtime'),runtime=JSON.parse(fs.readFileSync(path.join(root,'media-runtime.json'),'utf8')),reports=[];
 const settings=JSON.parse(fs.readFileSync(path.join(root,'original-baseline.json'),'utf8')).settings,ffmpeg=new Media({data:{settings}}).binaries().ffmpeg;
 for(const media of runtime.media){
  const base=await sharp(media.frames[0].path).removeAlpha().raw().toBuffer(),counts=[];
  for(const frame of media.frames){
   const data=await sharp(frame.path).removeAlpha().raw().toBuffer();let count=0;
   for(let i=0;i<data.length;i+=3)if(Math.max(Math.abs(data[i]-base[i]),Math.abs(data[i+1]-base[i+1]),Math.abs(data[i+2]-base[i+2]))>30)count++;
   counts.push({time:frame.time,pixelsAbove30:count});
  }
  assert.equal(counts[8].pixelsAbove30,0,media.name+'结束后无新增字幕');
  // 固定毫秒动画不随倍速压缩；补抽第四句开始0.55原时秒后，避开尚在淡入的帧。
  const stableTime=4.25*media.duration/8,stableFile=path.join(root,media.name,'late-entry.png');
  await runProcess(ffmpeg,['-y','-v','error','-ss',String(stableTime),'-i',media.path,'-frames:v','1','-update','1',stableFile]);
  const stable=await sharp(stableFile).removeAlpha().raw().toBuffer();let stableCount=0;
  for(let i=0;i<stable.length;i+=3)if(Math.max(Math.abs(stable[i]-base[i]),Math.abs(stable[i+1]-base[i+1]),Math.abs(stable[i+2]-base[i+2]))>30)stableCount++;
  counts.push({time:stableTime,path:stableFile,pixelsAbove30:stableCount});
  if(media.metadata.offsetY>=0){for(const i of [2,3,7])assert.ok(counts[i].pixelsAbove30>0,media.name+'稳定时段出现字形'+i);assert.ok(stableCount>0,media.name+'第四句稳定字形');}
  reports.push({name:media.name,frames:counts});
 }
 fs.writeFileSync(path.join(root,'actual-frame-checks.json'),JSON.stringify(reports,null,2));
 const layers=[];
 for(let r=0;r<6;r++)for(let c=0;c<6;c++){
  const media=runtime.media[r],frame=media.frames[c+2],input=await sharp(frame.path).extract({left:0,top:Math.floor(media.height/2),width:media.width,height:Math.ceil(media.height/2)}).resize(320,200,{fit:'contain',background:'#15151b'}).png().toBuffer();
  layers.push({input,left:c*320,top:r*225+25});
  const label=Buffer.from(`<svg width="320" height="25"><rect width="320" height="25" fill="#15151b"/><text x="8" y="17" font-family="Arial" font-size="12" fill="white">${media.name.replace('simple_','').replace('-offset0-speed1','')} | ${frame.time.toFixed(2)}s</text></svg>`);
  layers.push({input:label,left:c*320,top:r*225});
 }
 await sharp({create:{width:1920,height:1350,channels:3,background:'#15151b'}}).composite(layers).png().toFile(path.join(root,'actual-frames-review.png'));
 console.log(JSON.stringify({videos:reports.length,frames:reports.reduce((s,r)=>s+r.frames.length,0),endGapsWithNoHighDifferencePixels:reports.length,stableFrameAssertions:reports.filter(r=>!r.name.includes('offset-200')).length*4}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
