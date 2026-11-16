const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {Media,runProcess}=require('../server/media.cjs');
const {ComfyH3,graphSignature}=require('../server/comfy-h3.cjs');
const directory=path.resolve('evidence/validation/reference-video-night-20261115');
const read=name=>JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write=(name,data)=>fs.writeFileSync(path.join(directory,name),JSON.stringify(data,null,2));
async function main(){
 const collection=read('collection.json'),submission=read('submission.json');
 const inputs=JSON.parse(fs.readFileSync(path.resolve('evidence/validation/reference-sample-20261115/inputs.json'),'utf8'));
 const old=JSON.parse(fs.readFileSync(path.resolve('evidence/validation/reference-sample-20261115/media-verification.json'),'utf8'));
 const data=read('workspace/studio.json'),media=new Media({data}),h3=new ComfyH3({},{});
 assert.equal(collection.promptId,submission.promptId);assert.equal(hash(collection.exported),collection.sha256);
 assert.equal(hash(collection.asset.path),collection.sha256);assert.equal(graphSignature(submission.remote.graph),submission.remote.graphSha256);
 const history=(await h3.json(submission.remote.baseUrl,'/history/'+encodeURIComponent(submission.promptId)))[submission.promptId];
 assert.equal(history.status.status_str,'success');assert.equal(history.prompt[1],submission.promptId);
 assert.equal(history.prompt[3].client_id,submission.clientId);assert.equal(graphSignature(history.prompt[2]),submission.remote.graphSha256);
 write('confirmed-history.json',history);
 const rawItem=history.outputs['16'].images.find(item=>item.type==='output'&&/\.mp4$/i.test(item.filename));assert(rawItem);
 const rawQuery=new URLSearchParams({filename:rawItem.filename,subfolder:rawItem.subfolder||'',type:rawItem.type});
 const rawResponse=await h3.request(submission.remote.baseUrl,'/view?'+rawQuery);assert(rawResponse.ok);
 const rawBytes=Buffer.from(await rawResponse.arrayBuffer()),rawSha256=crypto.createHash('sha256').update(rawBytes).digest('hex');
 assert.equal(rawSha256,collection.asset.h3.generatedVideoSha256);
 const rawFile=path.join(directory,'model-raw.mp4');fs.writeFileSync(rawFile,rawBytes);
 const sourceFiles=[
  {key:'source',label:'SOURCE',file:inputs.source},
  {key:'original',label:'ORIGINAL',file:inputs.original},
  {key:'image',label:'IMAGE',file:old.reports.generated.exported},
  {key:'ref2va',label:'REF2VA',file:collection.exported},
 ];
 const protectedFiles=inputs.protectedFiles.map(row=>({...row,unchanged:hash(row.file)===row.sha256}));assert(protectedFiles.every(row=>row.unchanged));
 const uploadChecks=[];
 for(const [label,input,local] of [['image',submission.remote.image,path.join(directory,'first-frame.png')],['referenceVideo',submission.reference.uploaded,submission.reference.file],['driver',submission.remote.audio,inputs.audio.path]]){
  assert.equal(hash(local),input.sha256);
  const q=new URLSearchParams({filename:input.name,subfolder:input.subfolder||'',type:input.type});
  const response=await h3.request(submission.remote.baseUrl,'/view?'+q);assert(response.ok,'无法只读核验已上传的'+label);
  const bytes=Buffer.from(await response.arrayBuffer()),uploadedSha256=crypto.createHash('sha256').update(bytes).digest('hex');assert.equal(uploadedSha256,input.sha256);
  uploadChecks.push({label,local,sha256:input.sha256,uploadedSha256,matched:true});
 }
 const streams=await media.probe(collection.exported),video=streams.streams.find(row=>row.codec_type==='video'),audio=streams.streams.find(row=>row.codec_type==='audio');
 assert.equal(video.avg_frame_rate,'24/1');assert.equal(Number(video.nb_frames),192);assert.equal(video.width,608);assert.equal(video.height,1056);
 assert(Number(video.duration)+.001>=Number(audio.duration));assert(Math.abs(Number(streams.format.duration)-8)<.1);
 await runProcess(media.binaries().ffmpeg,['-v','error','-i',collection.exported,'-f','null','-']);
 const pcm=async(file,key)=>{const output=path.join(directory,key+'.pcm');await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',file,'-vn','-ac','1','-ar','32000','-c:a','pcm_s16le','-f','s16le',output]);return fs.readFileSync(output);};
 const reference=await pcm(inputs.audio.path,'driver'),actual=await pcm(collection.exported,'result');let xx=0,xy=0,yy=0;
 const count=Math.floor(Math.min(reference.length,actual.length)/2);for(let i=0;i<count;i++){const x=reference.readInt16LE(i*2),y=actual.readInt16LE(i*2);xx+=x*x;xy+=x*y;yy+=y*y;}
 const correlation=xy/Math.sqrt(xx*yy);assert(correlation>.98);
 // 像素指纹只用于排除同画面直接复用，不作为模型质量或口型准确率。
 const fingerprints=[];
 for(const source of sourceFiles){
  const fingerprint=path.join(directory,source.key+'-framehash.txt');
  await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',source.file,'-t','8','-an','-vf','fps=24,scale=608:1056','-f','framehash','-hash','sha256',fingerprint]);
  const frames=fs.readFileSync(fingerprint,'utf8').split(/\r?\n/).filter(row=>row&&!row.startsWith('#')).map(row=>row.split(',').at(-1).trim());assert.equal(frames.length,192);
  fingerprints.push({key:source.key,file:source.file,sha256:hash(source.file),frameHashes:frames});
 }
 const final=fingerprints.at(-1),pictureDifference=fingerprints.slice(0,-1).map(row=>({comparedWith:row.key,equalFrames:row.frameHashes.filter((value,i)=>value===final.frameHashes[i]).length,totalFrames:192}));
 assert(pictureDifference.every(row=>row.equalFrames<192),'新产物与现有输入画面完全相同，不能认定新画面');
 const rawFingerprint=path.join(directory,'model-raw-framehash.txt');
 await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',rawFile,'-t','8','-an','-vf','fps=24,scale=608:1056','-f','framehash','-hash','sha256',rawFingerprint]);
 const rawFrameHashes=fs.readFileSync(rawFingerprint,'utf8').split(/\r?\n/).filter(row=>row&&!row.startsWith('#')).map(row=>row.split(',').at(-1).trim());assert.deepEqual(rawFrameHashes,final.frameHashes,'封装画面与实际模型产物不一致');
 const ffmpeg=media.binaries().ffmpeg,comparison=path.join(directory,'comparison-four-way.mp4'),font='C\\:/Windows/Fonts/segoeui.ttf';
 const fit='scale=288:512:force_original_aspect_ratio=decrease,pad=288:512:(ow-iw)/2:(oh-ih)/2';
 const filters=sourceFiles.map((source,i)=>`[${i}:v]trim=duration=8,setpts=PTS-STARTPTS,fps=24,${fit},drawbox=x=0:y=0:w=iw:h=27:color=black:t=fill,drawtext=fontfile='${font}':text='${source.label}':fontcolor=white:fontsize=17:x=8:y=4[v${i}]`);
 filters.push('[v0][v1][v2][v3]hstack=inputs=4[out]');
 await runProcess(ffmpeg,['-v','error','-y',...sourceFiles.flatMap(row=>['-i',row.file]),'-filter_complex',filters.join(';'),'-map','[out]','-map','3:a:0','-t','8','-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',comparison]);
 await runProcess(ffmpeg,['-v','error','-i',comparison,'-f','null','-']);
 const times=[.25,1,2,3,4,5,6,7,7.9],samples=[];
 for(let index=0;index<times.length;index++){
  const file=path.join(directory,'comparison-'+String(index).padStart(2,'0')+'.jpg');
  await runProcess(ffmpeg,['-v','error','-y','-ss',String(times[index]),'-i',comparison,'-frames:v','1','-vf',`drawtext=fontfile='${font}':text='${times[index].toFixed(2)}s':fontcolor=white:fontsize=17:x=8:y=30`,'-update','1',file]);samples.push({time:times[index],file});
 }
 const sheets=[];
 for(let index=0;index<3;index++){
  const file=path.join(directory,'comparison-sheet-'+(index+1)+'.jpg');
  await runProcess(ffmpeg,['-v','error','-y',...samples.slice(index*3,index*3+3).flatMap(row=>['-i',row.file]),'-filter_complex','[0:v][1:v][2:v]vstack=inputs=3[out]','-map','[out]','-frames:v','1','-update','1',file]);sheets.push(file);
 }
 write('media-verification.json',{at:new Date().toISOString(),promptId:submission.promptId,graphSha256:submission.remote.graphSha256,historyGraphMatched:true,uploadChecks,protectedFiles,rawModel:{file:rawFile,sha256:rawSha256,framesMatchedWithMuxedOutput:192},video:{path:collection.exported,sha256:collection.sha256,width:video.width,height:video.height,fps:video.avg_frame_rate,frames:Number(video.nb_frames),duration:Number(streams.format.duration),pictureDuration:Number(video.duration),audioDuration:Number(audio.duration),fullDecodeVerified:true},audioCorrelation:correlation,pictureDifference,comparison:{file:comparison,columns:sourceFiles.map(row=>({key:row.key,label:row.label,file:row.file})),samples,sheets,fullDecodeVerified:true},originalAudioReused:true,newSpeechGenerated:false,newModelSubmissionsThisVerifier:0,submittedThroughProductButton:false,continuousLipSyncReviewed:false,audioAudited:false,qualityAccepted:false,referenceParityAccepted:false,completeReplica:false});
 console.log(JSON.stringify({verified:true,promptId:submission.promptId,comparison,sheets,qualityAccepted:false}));
}
main().catch(error=>{write('verification-error.json',{at:new Date().toISOString(),error:error.stack});console.error(error);process.exitCode=1;});
