const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const sharp=require('C:/Users/DELL/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const {Media,runProcess}=require('../server/media.cjs');
async function main(){
 const root=path.resolve('evidence/validation/subtitle-motion-runtime'),runtime=JSON.parse(fs.readFileSync(path.join(root,'media-runtime.json'),'utf8')),reports=[];
 const settings=JSON.parse(fs.readFileSync(path.join(root,'original-baseline.json'),'utf8')).settings,ffmpeg=new Media({data:{settings}}).binaries().ffmpeg;
 for(const media of runtime.media){
  const base=await sharp(media.frames[0].path).removeAlpha().raw().toBuffer(),counts=[];
  for(const frame of media.frames){const data=await sharp(frame.path).removeAlpha().raw().toBuffer();let count=0,minY=media.height,maxY=-1;for(let i=0;i<data.length;i+=3)if(Math.max(Math.abs(data[i]-base[i]),Math.abs(data[i+1]-base[i+1]),Math.abs(data[i+2]-base[i+2]))>30){count++;const y=Math.floor(i/3/media.width);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}counts.push({time:frame.time,pixelsAbove30:count,minY:count?minY:null,maxY:count?maxY:null});}
  assert.equal(counts.at(-1).pixelsAbove30,0,media.name+'最终空档');
  assert.ok(counts[2].pixelsAbove30>0||media.name.endsWith('gaps'),media.name+'首句稳定时段出现字幕');
  if(media.name.endsWith('gaps')){assert.equal(counts[2].pixelsAbove30,0);assert.equal(counts[3].pixelsAbove30,0);assert.equal(counts[4].pixelsAbove30,0);assert.ok(counts[6].pixelsAbove30>0);}
  if(media.templateId==='3d_flip'&&media.name.endsWith('cycle'))assert.ok(counts[8].pixelsAbove30>0,media.name+'本行结束后仍保留后景');
  reports.push({name:media.name,frames:counts});
 }
 fs.writeFileSync(path.join(root,'actual-frame-checks.json'),JSON.stringify(reports,null,2));
 // 生成可直接目视检查的横竖屏分组图，避免只凭边界和像素计数下结论。
 for(const [orientation,start]of [['portrait',0],['landscape',6]]){
  const layers=[];
  for(let r=0;r<6;r++)for(let c=0;c<6;c++){
   const media=runtime.media[start+r],frame=media.frames[[3,4,5,6,8,9][c]],input=await sharp(frame.path).extract({left:0,top:Math.floor(media.height/2),width:media.width,height:Math.ceil(media.height/2)}).resize(300,190,{fit:'contain',background:'#15151b'}).png().toBuffer();
   layers.push({input,left:c*300,top:r*215+25});
   layers.push({input:Buffer.from(`<svg width="300" height="25"><rect width="300" height="25" fill="#15151b"/><text x="6" y="17" font-family="Arial" font-size="12" fill="white">${media.templateId} | ${frame.time.toFixed(2)}s</text></svg>`),left:c*300,top:r*215});
  }
  await sharp({create:{width:1800,height:1290,channels:3,background:'#15151b'}}).composite(layers).png().toFile(path.join(root,orientation+'-frames-review.png'));
 }
 const layers=[];
 for(const [r,preview]of runtime.previews.entries())for(const [c,time]of [.9,4].entries()){
  const file=path.join(root,preview.id+'-preview-'+c+'.png');await runProcess(ffmpeg,['-y','-v','error','-ss',String(time),'-i',preview.path,'-frames:v','1','-update','1',file]);
  layers.push({input:await sharp(file).resize(402,225).png().toBuffer(),left:c*402,top:r*250+25});
  layers.push({input:Buffer.from(`<svg width="402" height="25"><rect width="402" height="25" fill="#15151b"/><text x="6" y="17" font-family="Arial" font-size="12" fill="white">${preview.id} | ${time}s</text></svg>`),left:c*402,top:r*250});
 }
 await sharp({create:{width:804,height:1500,channels:3,background:'#15151b'}}).composite(layers).png().toFile(path.join(root,'preview-frames-review.png'));
 console.log(JSON.stringify({videos:reports.length,frames:reports.reduce((s,r)=>s+r.frames.length,0),finalBlankAssertions:reports.length,gapBlankAssertions:3,tailAssertions:2}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
