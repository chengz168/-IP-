const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Media,runProcess}=require('../server/media.cjs');
async function main(){
 const root=path.resolve('evidence/validation/subtitle-motion-runtime'),run=JSON.parse(fs.readFileSync(path.join(root,'desktop-render.json'),'utf8')),baseline=JSON.parse(fs.readFileSync(path.join(root,'original-baseline.json'),'utf8')),media=new Media({data:{settings:baseline.settings}}),probe=await media.probe(run.output.path),video=probe.streams.find(s=>s.codec_type==='video');
 assert.equal(run.status,'succeeded');assert.equal(video.width,360);assert.equal(video.height,640);assert.ok(probe.streams.some(s=>s.codec_type==='audio'));assert.ok(Math.abs(Number(probe.format.duration)-16)<.1);
 await runProcess(media.binaries().ffmpeg,['-v','error','-i',run.output.path,'-f','null','-']);
 const frames=[];for(const time of [.2,.9,3.9,7.4,11.2,12.5,14.5]){const file=path.join(root,'desktop-'+time+'.png');await runProcess(media.binaries().ffmpeg,['-y','-v','error','-ss',String(time),'-i',run.output.path,'-frames:v','1','-update','1',file]);frames.push({time,path:file});}
 const report={runId:run.id,assetId:run.output.id,path:run.output.path,width:video.width,height:video.height,duration:Number(probe.format.duration),bytes:fs.statSync(run.output.path).size,audio:true,decodeExitCode:0,frames,metadata:run.output.renderedSubtitleTemplate};
 fs.writeFileSync(path.join(root,'desktop-media-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
