const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {Media,runProcess}=require('../server/media.cjs');

async function main(){
  const directory=path.resolve('evidence/validation/local-asr'),report=JSON.parse(fs.readFileSync(path.join(directory,'desktop-report.json'),'utf8')),state=JSON.parse(fs.readFileSync('evidence/validation/pip-desktop-workspace/studio.json','utf8'));
  const media=new Media({data:{settings:state.settings}}),asset=state.assets.find(a=>a.id===report.productId);assert(asset&&fs.existsSync(asset.path));
  const info=await media.probe(asset.path),video=info.streams.find(s=>s.codec_type==='video'),audio=info.streams.find(s=>s.codec_type==='audio');assert(video&&audio);assert.equal(video.width,1080);assert.equal(video.height,1920);assert(Math.abs(Number(info.format.duration)-report.transcription.duration)<.1);
  const frame=path.join(directory,'rendered-frame-4s.png');await runProcess(media.binaries().ffmpeg,['-v','error','-y','-ss','4','-i',asset.path,'-frames:v','1',frame]);
  const output={checkedAt:new Date().toISOString(),asset,video:{codec:video.codec_name,width:video.width,height:video.height},audio:{codec:audio.codec_name},duration:Number(info.format.duration),frame,scope:'真实文件的流、尺寸、时长和抽帧；源视频含烧录字幕，新字幕叠加不代表视觉品质验收'};
  fs.writeFileSync(path.join(directory,'products-report.json'),JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
