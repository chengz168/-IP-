const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Media,runProcess}=require('../server/media.cjs');
const {prepareLipSyncInput}=require('../integrations/musetalk-local/input.cjs');
const directory=path.resolve('evidence/validation/lipsync-native-input-20261115');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function main(){
 const before=JSON.parse(fs.readFileSync('evidence/validation/video-driver-audio/protected-before.json','utf8')).map(item=>({file:item.file,sha256:hash(item.file)}));
 const settings=JSON.parse(fs.readFileSync('evidence/validation/video-driver-audio/workspace/studio.json','utf8')).settings,media=new Media({data:{settings}});
 fs.mkdirSync(directory,{recursive:true});
 const manifest=await prepareLipSyncInput({videoPath:'F:/Software/轻语IP智能体/aigc-human/resources/assets/videos/示例2-夜间.mp4',audioPath:path.resolve('evidence/validation/reference-sample-20261115/workspace/assets/e0d85479-a859-4174-9756-ccff45442a22.wav'),directory:path.join(directory,'input-short-1'),media});
 const probe=await media.probe(manifest.driver.path),sound=probe.streams.find(stream=>stream.codec_type==='audio');
 if(sound.sample_rate!=='16000'||sound.channels!==1||sound.codec_name!=='pcm_s16le'||Number(probe.format.duration)!==8)throw Error('真实规范音轨格式不符');
 await runProcess(media.binaries().ffmpeg,['-v','error','-i',manifest.driver.path,'-f','null','-']);
 const protectedFiles=before.map(item=>({...item,unchanged:hash(item.file)===item.sha256}));if(protectedFiles.some(item=>!item.unchanged))throw Error('受保护文件变化');
 const report={at:new Date().toISOString(),manifest,actualAudioProbe:probe,fullDecodeVerified:true,protectedFiles,originalVideoCopied:false,originalVideoRepainted:false,newVideoGenerated:false,newSpeechGenerated:false,newModelSubmissions:0,qualityAccepted:false};
 fs.writeFileSync(path.join(directory,'preparation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({width:manifest.width,height:manifest.height,fps:manifest.fps,plannedFrames:manifest.frameCount,driverSamples:manifest.driver.samples,sourceFrames:manifest.sourceFrameCount,newModelSubmissions:0}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
