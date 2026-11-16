const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {Media,runProcess}=require('../server/media.cjs');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
async function main(){
 const attempt=path.resolve(process.argv[2]||'');if(!process.argv[2])throw Error('必须明确本轮推理目录');
 const result=JSON.parse(fs.readFileSync(path.join(attempt,'result.json'),'utf8'));
 if(result.status!=='technical-complete'||!result.inferenceVerified||!result.newVideoGenerated)throw Error('真实推理尚未完成，不创建成功对照');
 const input=JSON.parse(fs.readFileSync(path.join(attempt,'input-snapshot.json'),'utf8')),candidate=result.output.path;
 if(hash(fs.readFileSync(candidate))!==result.output.sha256)throw Error('候选视频SHA变化');
 const measurements=fs.readFileSync(path.join(attempt,'face-measurements.jsonl'),'utf8').trim().split(/\r?\n/).map(row=>JSON.parse(row));
 if(measurements.length!==input.frameCount||measurements.some((row,index)=>row.frame!==index||row.outsideFaceBoxIdenticalBeforeEncoding!==true)||!measurements.some(row=>row.changedPixelsInsideFaceBox>0))throw Error('局部生成记录不完整');
 const settings=JSON.parse(fs.readFileSync('evidence/validation/video-driver-audio/workspace/studio.json','utf8')).settings,media=new Media({data:{settings}}),{ffmpeg}=media.binaries();
 const directory=path.join(attempt,'review');fs.mkdirSync(directory);
 const original='F:/Software/轻语IP智能体/aigc-human/outputs/videos/cloud_1794663289391.mp4',files=[['source',input.video.path],['original',original],['candidate',candidate]],decoded=[];
 const width=108,height=192,size=width*height;
 for(const [key,file]of files){const child=spawnSync(ffmpeg,['-v','error','-i',file,'-map','0:v:0','-an','-vf',`fps=30,scale=${width}:${height}:flags=area,format=gray`,'-t','8','-f','rawvideo','pipe:1'],{windowsHide:true,maxBuffer:16*1024*1024,timeout:60000});if(child.error||child.status!==0)throw child.error||Error(child.stderr.toString());if(child.stdout.length!==240*size)throw Error('测量帧数不符');decoded.push({key,file,sha256:hash(fs.readFileSync(file)),data:child.stdout});}
 const background=decoded.slice(1).map(item=>{let total=0,count=0;for(let frame=0;frame<240;frame++)for(let pixel=0;pixel<size;pixel++){const x=pixel%width;if(x<Math.floor(width*.2)||x>=Math.ceil(width*.8)){total+=Math.abs(decoded[0].data[frame*size+pixel]-item.data[frame*size+pixel]);count++;}}return {key:item.key,edgeMeanAbsoluteError:total/count};});
 const audio=path.join(directory,'candidate-driver.wav');await runProcess(ffmpeg,['-v','error','-n','-i',candidate,'-map','0:a:0','-ac','1','-ar','16000','-c:a','pcm_s16le',audio]);
 const raw=file=>{const child=spawnSync(ffmpeg,['-v','error','-i',file,'-ac','1','-ar','16000','-f','s16le','pipe:1'],{windowsHide:true,maxBuffer:2*1024*1024,timeout:30000});if(child.status!==0)throw Error('音轨解码失败');return child.stdout;};
 const a=raw(input.driver.path),b=raw(audio),samples=Math.min(a.length,b.length)/2;let aa=0,bb=0,ab=0;for(let i=0;i<samples;i++){const x=a.readInt16LE(i*2),y=b.readInt16LE(i*2);aa+=x*x;bb+=y*y;ab+=x*y;}const correlation=ab/Math.sqrt(aa*bb);if(!Number.isFinite(correlation)||correlation<.95)throw Error('输出音轨与既有驱动偏差过大');
 const font='C\\:/Windows/Fonts/arial.ttf',comparison=path.join(directory,'comparison.mp4');
 const chains=['SOURCE','ORIGINAL','MUSETALK'].map((label,index)=>`[${index}:v]trim=duration=8,setpts=PTS-STARTPTS,scale=324:576:flags=lanczos,setsar=1,drawtext=fontfile='${font}':text='${label}':fontsize=19:fontcolor=white:box=1:boxcolor=black@0.65:x=8:y=8[v${index}]`);
 chains.push('[v0][v1][v2]hstack=inputs=3[v]');
 await runProcess(ffmpeg,['-v','error','-n','-i',input.video.path,'-i',original,'-i',candidate,'-filter_complex',chains.join(';'),'-map','[v]','-map','2:a:0','-t','8','-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',comparison]);
 const times=[0,.5,1,2,3,4,5,6,7.75];
 for(let index=0;index<times.length;index++)await runProcess(ffmpeg,['-v','error','-n','-ss',String(times[index]),'-i',comparison,'-frames:v','1',path.join(directory,`frame-${String(index).padStart(2,'0')}.png`)]);
 const montage=path.join(directory,'comparison-grid.jpg');await runProcess(ffmpeg,['-v','error','-n','-framerate','1','-i',path.join(directory,'frame-%02d.png'),'-vf','tile=3x3','-frames:v','1','-q:v','2',montage]);
 const protectedBefore=JSON.parse(fs.readFileSync('evidence/validation/lipsync-native-input-20261115/delivery-report.json','utf8')).protectedFiles;
 const protectedFiles=protectedBefore.map(item=>({...item,unchanged:hash(fs.readFileSync(item.file))===item.sha256}));if(protectedFiles.some(item=>!item.unchanged))throw Error('受保护文件变化');
 const report={at:new Date().toISOString(),candidate:result.output,sourceReusedOutsideFace:true,generatedFaceFrames:measurements.length,inferenceCalls:result.inferenceCalls,allOutsideFaceBoxesIdenticalBeforeEncoding:true,originalAudioReused:true,newSpeechGenerated:false,audio:{samples,correlation},background:{method:'前8秒同时间戳，108×192灰度，左右各20%边缘MAE；仅局部背景保持，不是口型/身份/真实感分数',results:background},comparison,montage,sampleTimes:times,protectedFiles,continuousLipSyncAccepted:false,listeningAccepted:false,qualityAccepted:false,referenceParityAccepted:false,completeReplica:false};
 fs.writeFileSync(path.join(directory,'measurement.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({comparison,montage,audio:report.audio,background:report.background.results,qualityAccepted:false},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
