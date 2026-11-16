const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {Media,runProcess}=require('../server/media.cjs');
const directory=path.resolve('evidence/validation/render-stability-20261115'),hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function main(){
 const desktop=JSON.parse(fs.readFileSync(path.join(directory,'desktop-report.json'),'utf8')),data=JSON.parse(fs.readFileSync(path.join(directory,'desktop-workspace/studio.json'),'utf8'));
 const media=new Media({data}),outputs=[];
 for(const render of desktop.renders){
  const asset=data.assets.find(asset=>asset.id===render.outputId);assert(asset);
  await runProcess(media.binaries().ffmpeg,['-v','error','-i',asset.path,'-f','null','-']);
  const probe=await media.probe(asset.path),video=probe.streams.find(stream=>stream.codec_type==='video');
  assert.equal(video.width,608);assert.equal(video.height,1056);assert.equal(video.nb_frames,'192');assert.equal(Number(probe.format.duration),8);
  outputs.push({runId:render.id,assetId:asset.id,file:asset.path,sha256:hash(asset.path),width:video.width,height:video.height,frames:video.nb_frames,duration:Number(probe.format.duration),fullDecodeVerified:true});
 }
 const last=outputs.at(-1),exported=path.join(directory,'edited-stable-runtime.mp4');if(fs.existsSync(exported))assert.equal(hash(exported),last.sha256);else fs.copyFileSync(last.file,exported);
 const previous=JSON.parse(fs.readFileSync(path.join(directory,'before-runtime-update.json'),'utf8'));
 const protectedFiles=previous.protectedFiles.map(item=>({...item,unchanged:hash(item.file)===item.sha256}));assert(protectedFiles.every(item=>item.unchanged));
 const titleHashMatches=hash(path.join(directory,'baseline39-title-0.png'))===hash(path.join(directory,'installed40-title-0.png'));assert(titleHashMatches);
 const report={at:new Date().toISOString(),outputs,exported,titleHashMatches,protectedFiles,additionalModelSubmissions:0,existingGeneratedVideoReused:true,originalAudioReused:true,qualityAccepted:false,referenceParityAccepted:false,completeReplica:false};
 fs.writeFileSync(path.join(directory,'media-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({outputs:outputs.length,fullDecodeVerified:true,exported,titleHashMatches,protectedFilesUnchanged:true}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
