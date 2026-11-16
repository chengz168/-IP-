const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const sharp=require('C:/Users/DELL/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const {Media,runProcess}=require('../server/media.cjs');
async function main(){
 const root=path.resolve('evidence/validation/subtitle-color-bilingual-runtime'),settings=JSON.parse(fs.readFileSync(path.join(root,'workspace-before.json'),'utf8')).settings,media=new Media({data:{settings}}),report=[];
 for(const type of ['pinyin','bilingual']){
  const run=JSON.parse(fs.readFileSync(path.join(root,'desktop-'+type+'-render.json'),'utf8')),probe=await media.probe(run.output.path),video=probe.streams.find(s=>s.codec_type==='video');assert.equal(video.width,360);assert.equal(video.height,640);assert.ok(probe.streams.some(s=>s.codec_type==='audio'));assert.ok(Math.abs(Number(probe.format.duration)-8)<.1);assert.equal(run.output.renderedSubtitleTemplate.pixelShift,119);assert.equal(run.output.renderedSubtitleTemplate.keywords,true);await runProcess(media.binaries().ffmpeg,['-v','error','-i',run.output.path,'-f','null','-']);
  const frames=[];let baseline;
  for(const time of [.2,.48,.9,2,2.8,4.3,5.4,6.5,7.5]){
   const file=path.join(root,'desktop-'+type+'-'+time+'.png');await runProcess(media.binaries().ffmpeg,['-y','-v','error','-ss',String(time),'-i',run.output.path,'-frames:v','1','-update','1',file]);const data=await sharp(file).removeAlpha().raw().toBuffer();if(!baseline)baseline=data;let changed=0,warm=0;for(let i=0;i<data.length;i+=3){if(Math.max(Math.abs(data[i]-baseline[i]),Math.abs(data[i+1]-baseline[i+1]),Math.abs(data[i+2]-baseline[i+2]))>30)changed++;if(data[i]>data[i+1]+10&&data[i+1]>data[i+2]+30)warm++;}frames.push({time,path:file,pixelsAbove30:changed,warmPixels:warm});
  }
  assert.equal(frames.at(-1).pixelsAbove30,0);assert.ok(frames[2].pixelsAbove30>0);if(type==='pinyin')assert.ok(frames[2].warmPixels>0,'注音正文实际关键词着色');
  report.push({type,runId:run.id,assetId:run.output.id,path:run.output.path,width:video.width,height:video.height,duration:Number(probe.format.duration),bytes:fs.statSync(run.output.path).size,audio:true,decodeExitCode:0,metadata:run.output.renderedSubtitleTemplate,frames});
 }
 fs.writeFileSync(path.join(root,'desktop-media-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({desktopRenders:report.length,frames:report.reduce((n,r)=>n+r.frames.length,0),pinyinWarmPixels:report[0].frames[2].warmPixels,decodeExitCode:0}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
