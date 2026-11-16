const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {Media,runProcess}=require('../server/media.cjs');
const directory=path.resolve('evidence/validation/reference-sample-20261115');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function main(){
 const data=JSON.parse(fs.readFileSync(path.join(directory,'workspace/studio.json'),'utf8')),input=JSON.parse(fs.readFileSync(path.join(directory,'inputs.json'),'utf8'));
 const draft=data.drafts[0],store={data,asset:id=>data.assets.find(asset=>asset.id===id)},media=new Media(store);
 const run=data.runs.find(run=>run.type==='avatar');assert.equal(run.status,'succeeded',run.error);
 assert.equal(data.runs.filter(run=>run.type==='avatar').length,1);
 const reports={};
 for(const [name,id]of Object.entries({generated:draft.video.assetId,edited:draft.edit.resultId})){
  assert(id,name+'尚无产物');const asset=store.asset(id),probe=await media.probe(asset.path),picture=probe.streams.find(stream=>stream.codec_type==='video');
  await runProcess(media.binaries().ffmpeg,['-v','error','-i',asset.path,'-f','null','-']);
  const output=path.join(directory,name+'.mp4');if(fs.existsSync(output))assert.equal(hash(output),hash(asset.path));else fs.copyFileSync(asset.path,output);
  const frames=[];
  for(const time of [.25,1,2,3,4,5,6,7,7.9]){const frame=path.join(directory,name+'-frame-'+time+'.jpg');await runProcess(media.binaries().ffmpeg,['-v','error','-y','-ss',String(time),'-i',asset.path,'-frames:v','1','-update','1',frame]);frames.push({time,file:frame});}
  reports[name]={id,path:asset.path,exported:output,sha256:hash(asset.path),bytes:fs.statSync(asset.path).size,duration:Number(probe.format.duration),width:picture.width,height:picture.height,fps:picture.avg_frame_rate,frames:picture.nb_frames,fullDecodeVerified:true,samples:frames};
  assert(Math.abs(Number(probe.format.duration)-8)<.1);
 }
 const raw=store.asset(draft.video.assetId);assert.equal(raw.origin,'comfy-h3');assert.equal(raw.h3.promptId,run.remoteId);
 assert.equal(raw.h3.driverSha256,input.audio.sha256);assert.notEqual(hash(raw.path),hash(input.original));
 assert.equal(raw.h3.sourceImageSha256,run.remote.image.sha256);
 const pcm=async(file,name)=>{const output=path.join(directory,name+'.pcm');await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',file,'-vn','-ac','1','-ar','32000','-c:a','pcm_s16le','-f','s16le',output]);return fs.readFileSync(output);};
 const reference=await pcm(input.audio.path,'reference-audio'),actual=await pcm(raw.path,'generated-audio');let xy=0,xx=0,yy=0;
 const samples=Math.min(reference.length,actual.length)/2;for(let i=0;i<samples;i++){const x=reference.readInt16LE(i*2),y=actual.readInt16LE(i*2);xy+=x*y;xx+=x*x;yy+=y*y;}
 const correlation=xy/Math.sqrt(xx*yy);assert(correlation>.98,'生成成片音轨与驱动差距过大');
 const sheet=path.join(directory,'comparison.mp4');
 await runProcess(media.binaries().ffmpeg,['-v','error','-n','-i',input.original,'-i',raw.path,'-filter_complex','[0:v]trim=duration=8,setpts=PTS-STARTPTS,scale=432:768:force_original_aspect_ratio=decrease,pad=432:768:(ow-iw)/2:(oh-ih)/2,fps=24[a];[1:v]scale=432:768:force_original_aspect_ratio=decrease,pad=432:768:(ow-iw)/2:(oh-ih)/2,fps=24[b];[a][b]hstack=inputs=2[v]','-map','[v]','-map','1:a:0','-t','8','-c:v','libx264','-crf','19','-c:a','aac','-movflags','+faststart',sheet]);
 const report={at:new Date().toISOString(),runId:run.id,promptId:run.remoteId,reports,comparison:{file:sheet,left:'原软件既有成片前8秒',right:'本次本地H3新画面',audio:'复用原成片驱动音轨'},audioCorrelation:correlation,originalAudioReused:true,newSpeechGenerated:false,newModelSubmissions:1,protectedFiles:input.protectedFiles.map(item=>({...item,unchanged:hash(item.file)===item.sha256})),continuousLipSyncReviewed:false,qualityAccepted:false,referenceParityAccepted:false,completeReplica:false};
 assert(report.protectedFiles.every(item=>item.unchanged));fs.writeFileSync(path.join(directory,'media-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
