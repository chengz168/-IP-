const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {Media,runProcess}=require('../server/media.cjs');
// 只读隔离工作区，将实际朗读片段完整解码，与源文件对应选区逐字节核对。
(async()=>{
 const root=path.resolve('evidence/validation/voice-trim'),data=JSON.parse(fs.readFileSync(path.join(root,'desktop-workspace/studio.json'),'utf8')),report=JSON.parse(fs.readFileSync(path.join(root,'desktop-report.json'),'utf8'));
 const clip=data.assets.find(a=>a.id==='ae1a0b24-612c-47ef-a328-186198063bcb'),source=data.assets.find(a=>a.id===clip.voiceTrim.sourceId),media=new Media({data}),temp=path.join(root,'speech-pcm-check');
 assert(!fs.existsSync(temp));fs.mkdirSync(temp);
 try{
  const info=await media.probe(clip.path),stream=info.streams.find(s=>s.codec_type==='audio');assert.equal(Number(info.format.duration),6);assert.equal(stream.sample_rate,'24000');assert.equal(stream.channels,1);
  await runProcess(media.binaries().ffmpeg,['-v','error','-i',clip.path,'-f','null','-']);
  const selected=path.join(temp,'selected.pcm'),actual=path.join(temp,'actual.pcm');
  await runProcess(media.binaries().ffmpeg,['-v','error','-i',source.path,'-map','0:a:0','-af','atrim=start=3:end=9,asetpts=PTS-STARTPTS','-ac','1','-ar','24000','-f','s16le',selected]);
  await runProcess(media.binaries().ffmpeg,['-v','error','-i',clip.path,'-ac','1','-ar','24000','-f','s16le',actual]);
  assert.deepEqual(fs.readFileSync(actual),fs.readFileSync(selected));
  const artifact=path.join(root,'系统朗读_选区3到9秒.wav');assert(!fs.existsSync(artifact));fs.copyFileSync(clip.path,artifact);
  const sha256=crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');assert.equal(sha256,clip.voiceTrim.outputSha256);
  const result={checkedAt:new Date().toISOString(),artifact,sourceId:source.id,clipId:clip.id,start:3,end:9,duration:6,sampleRate:24000,channels:1,sha256,fullDecodeVerified:true,exactSelectedPcmBytesMatch:true,newModelRequests:0,audioAudited:false,cloneQualityVerified:false,referenceParityAccepted:false};
  fs.writeFileSync(path.join(root,'speech-media-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
