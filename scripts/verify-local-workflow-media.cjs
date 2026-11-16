// 检查完整自动链实际产物、驱动来源和字幕；数值通过不等于听感或连续口型通过。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Media,runProcess}=require('../server/media.cjs'),{digest}=require('../integrations/musetalk-local/input.cjs');
const {sourceIndex}=require('../integrations/musetalk-local/production-input.cjs');
const {simplified,normalize}=require('./verify-indextts-output.cjs');
const base=path.resolve('evidence/validation/local-full-workflow-20261115'),revision=process.argv[2]||'';assert(/^[a-z0-9-]*$/.test(revision));
const root=revision?path.join(base,revision):base;
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
async function main(){
 assert(!fs.existsSync(path.join(root,'media-inspection.json')),'已有本批媒体检查，不覆盖');
 const generated=read('generated.json'),{outputs,draft,runs}=generated,baseline=JSON.parse(fs.readFileSync(path.join(base,'baseline.json'),'utf8'));
 const data=JSON.parse(fs.readFileSync('evidence/validation/musetalk-integration-20261115/workspace/studio.json','utf8'));
 const media=new Media({data}),{ffmpeg,ffprobe}=media.binaries(),probes={};
 for(const [kind,asset] of Object.entries(outputs)){
  assert.equal(digest(asset.path),asset.sha256);assert.equal(digest(asset.reviewFile),asset.sha256);
  probes[kind]=JSON.parse(await runProcess(ffprobe,['-v','error','-count_frames','-show_streams','-show_format','-of','json',asset.path]));
  await runProcess(ffmpeg,['-v','error','-xerror','-i',asset.path,'-f','null','-']);
 }
 const speech=outputs.speech,avatar=outputs.avatar,render=outputs.render,cover=outputs.cover;
 const picture=probes.avatar.streams.find(s=>s.codec_type==='video'),edited=probes.render.streams.find(s=>s.codec_type==='video'),image=probes.cover.streams.find(s=>s.codec_type==='video');
 assert.equal(picture.width,1080);assert.equal(picture.height,1920);assert.equal(edited.width,1080);assert.equal(edited.height,1920);assert.equal(image.width,1080);assert.equal(image.height,1920);
 assert.equal(render.renderedSubtitleTemplate.templateId,'simple_blue_white');assert.equal(render.renderedSubtitleTemplate.engineVersion,2);assert.deepEqual(render.renderedCaptions,draft.edit.captions);
 assert(cover.coverSignature.includes('"template":"v3"'));assert(draft.cover.scene.layers.some(l=>l.id==='main'&&l.text===draft.cover.title));
 const avatarRun=runs.find(r=>r.type==='avatar'),worker=JSON.parse(fs.readFileSync(path.join(avatarRun.local.directory,'result.json'),'utf8')),input=JSON.parse(fs.readFileSync(path.join(avatarRun.local.directory,'input-snapshot.json'),'utf8'));
 assert.equal(worker.status,'technical-complete');assert.equal(input.audio.sha256,speech.sha256);assert.equal(input.audio.path,speech.path);assert.equal(Number(picture.nb_read_frames),input.frameCount);assert.equal(worker.generatedFrames,input.frameCount);
 const measurements=fs.readFileSync(path.join(avatarRun.local.directory,'face-measurements.jsonl'),'utf8').trim().split(/\r?\n/).map(JSON.parse);
 assert.equal(measurements.length,input.frameCount);assert(measurements.every((row,index)=>row.frame===index&&row.sourceFrame===sourceIndex(index,input.sourceFrameCount)&&row.outsideFaceBoxIdenticalBeforeEncoding&&row.changedPixelsInsideFaceBox>0));
 const pcm={};for(const [kind,asset] of Object.entries({speech,avatar,render})){
  const file=path.join(root,kind+'-16k.pcm');await runProcess(ffmpeg,['-v','error','-n','-i',asset.path,'-map','0:a:0','-ac','1','-ar','16000','-c:a','pcm_s16le','-f','s16le',file]);pcm[kind]=fs.readFileSync(file);
 }
 let fullScale=0,peak=0;for(let i=0;i<pcm.speech.length;i+=2){const n=pcm.speech.readInt16LE(i);peak=Math.max(peak,Math.abs(n));if(n===32767||n===-32768)fullScale++;}assert.equal(fullScale,0);assert(peak>0);
 const correlations={};for(const kind of ['avatar','render']){const a=pcm.speech,b=pcm[kind],samples=Math.min(a.length,b.length)/2;let aa=0,bb=0,ab=0;for(let i=0;i<samples;i++){const x=a.readInt16LE(i*2),y=b.readInt16LE(i*2);aa+=x*x;bb+=y*y;ab+=x*y;}const correlation=ab/Math.sqrt(aa*bb);assert(correlation>.95);assert(b.length>=a.length-160);correlations[kind]={correlation,comparedSamples:samples,expectedSamples:a.length/2,actualSamples:b.length/2};}
 const asr=runs.find(r=>r.type==='transcribe');assert.equal(asr.output.sourceAssetId,avatar.id);
 const recognized=simplified(asr.output.text),expected=JSON.parse(fs.readFileSync(path.join(base,'prepared.json'),'utf8')).text,textMatches=normalize(recognized)===normalize(expected);
 const samples=draft.edit.captions.filter(row=>row.end-row.start>.3).slice(0,4).map(row=>({time:Math.min((row.start+row.end)/2,row.end-.05),text:row.text}));assert(samples.length>0);
 for(let i=0;i<samples.length;i++)await runProcess(ffmpeg,['-v','error','-n','-ss',String(samples[i].time),'-i',render.path,'-frames:v','1','-vf','scale=324:576:flags=lanczos',path.join(root,'caption-'+String(i).padStart(2,'0')+'.png')]);
 const grid=path.join(root,'caption-grid.jpg');await runProcess(ffmpeg,['-v','error','-n','-framerate','1','-i',path.join(root,'caption-%02d.png'),'-vf','tile='+samples.length+'x1','-frames:v','1','-q:v','2',grid]);
 assert(baseline.protectedFiles.every(p=>digest(p.file)===p.sha256));
 const report={at:new Date().toISOString(),jobId:generated.job.id,newSpeechGenerated:true,newLipSyncGenerated:true,fullDecodeVerified:true,probes,actualFrameCount:input.frameCount,inferenceCalls:worker.inferenceCalls,allFramesSourceChecked:true,allOutsideFaceBoxesUnchangedBeforeEncoding:true,sourceBodyAndBackgroundReused:true,correlations,signal:{fullScaleSamples:fullScale,peakNormalized:peak/32768},asr:{runId:asr.id,sourceAssetId:avatar.id,engine:asr.output.engine,expected,recognized,textMatches},captions:draft.edit.captions,template:render.renderedSubtitleTemplate,coverSignature:cover.coverSignature,coverScene:draft.cover.scene,samples,grid,protectedFilesUnchanged:baseline.protectedFiles.length,listeningAccepted:false,naturalnessAccepted:false,continuousLipSyncAccepted:false,referenceParityAccepted:false,completeReplica:false};
 fs.writeFileSync(path.join(root,'media-inspection.json'),JSON.stringify(report,null,2),{flag:'wx'});
 console.log(JSON.stringify({jobId:report.jobId,duration:probes.render.format.duration,frames:input.frameCount,correlations,textMatches,recognized,captionCount:draft.edit.captions.length,grid,qualityAccepted:false}));
}
main().catch(error=>{console.error(error);process.exitCode=1});
