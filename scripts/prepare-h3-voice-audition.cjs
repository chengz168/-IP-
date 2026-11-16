const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Media,runProcess}=require('../server/media.cjs'),{digest}=require('../integrations/musetalk-local/input.cjs');
const root=path.resolve('evidence/validation/voice-design-20261115/h3-autonomous');
async function main(){
 const source=JSON.parse(fs.readFileSync(path.join(root,'generated.json'),'utf8')),inspection=JSON.parse(fs.readFileSync(path.join(root,'audio-inspection.json'),'utf8'));
 assert.equal(digest(source.audio),source.audioSha256);assert.equal(inspection.signal.nonFinitePoints,0);
 const data=JSON.parse(fs.readFileSync('evidence/validation/musetalk-integration-20261115/workspace/studio.json','utf8')),media=new Media({data});
 const output=path.join(root,'h3-autonomous-voice-listen.wav'),pcm=path.join(root,'audition-native.s16le'),gain=Math.min(1,.95/inspection.signal.peak);
 assert(!fs.existsSync(output),'已有试听版，不覆盖');
 await runProcess(media.binaries().ffmpeg,['-v','error','-n','-i',source.audio,'-map','0:a:0','-af','volume='+gain+':precision=double','-c:a','pcm_s16le',output]);
 await runProcess(media.binaries().ffmpeg,['-v','error','-xerror','-i',output,'-f','null','-']);
 await runProcess(media.binaries().ffmpeg,['-v','error','-n','-i',output,'-c:a','pcm_s16le','-f','s16le',pcm]);
 const bytes=fs.readFileSync(pcm);let peak=0,fullScalePoints=0;for(let i=0;i<bytes.length;i+=2){const value=bytes.readInt16LE(i);peak=Math.max(peak,Math.abs(value));if(value===32767||value===-32768)fullScalePoints++;}
 assert.equal(fullScalePoints,0);assert.equal(bytes.length/2,inspection.signal.samples);
 const probe=await media.probe(output);assert.equal(Number(probe.format.duration),Number(inspection.probe.format.duration));
 assert.equal(digest(source.audio),source.audioSha256);
 const report={at:new Date().toISOString(),file:output,sha256:digest(output),probe,source:{file:source.audio,sha256:source.audioSha256,sourceVideoSha256:source.videoSha256,promptId:source.promptId},
  operation:'对AAC解码后的浮点音轨做统一降音量及PCM16量化，未变速、未改调、未降噪、未改台词',gain,samples:bytes.length/2,peakNormalized:peak/32768,
  fullScalePoints,sourceFloatFullScalePoints:inspection.signal.fullScalePoints,sourceFloatPeak:inspection.signal.peak,
  fullDecodeVerified:true,asrCheckedOnSource:inspection.asrTextMatchesInput,referenceAudio:null,newModelInferencePerformed:false,
  note:'AAC解码浮点超满幅并不能单独证明模型原始音轨发生削波；未取得编码前原始模型音轨，不能据此定位失真来源',
  listeningAccepted:false,characterMatchAccepted:false,qualityAccepted:false};
 fs.writeFileSync(path.join(root,'audition.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({file:output,gain,samples:report.samples,fullScalePoints,qualityAccepted:false}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
