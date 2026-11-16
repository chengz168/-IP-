const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createService}=require('../server/service.cjs'),{runProcess}=require('../server/media.cjs');
const root=path.resolve('evidence/validation/microphone-recording'),settings=JSON.parse(fs.readFileSync(path.join(root,'original-baseline.json'),'utf8')).settings;
(async()=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'superip-record-media-')),s=createService(workspace);Object.assign(s.store.data.settings,{ffmpegPath:settings.ffmpegPath,ffprobePath:settings.ffprobePath,outputDir:path.join(workspace,'outputs')});s.store.save();
 const checks=[];
 try{
  const webm=path.join(workspace,'tone.webm');await runProcess(settings.ffmpegPath,['-v','error','-y','-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=1.5','-c:a','libopus',webm]);
  const payload={id:s.store.draft().id,mimeType:'audio/webm;codecs=opus',base64:fs.readFileSync(webm).toString('base64')},before=structuredClone(s.store.draft());
  const saved=await s.invoke('importRecording',payload);assert.equal(saved.type,'audio');assert.equal(saved.origin,'microphone-recording');assert(Math.abs(saved.duration-1.5)<0.03);await runProcess(settings.ffmpegPath,['-v','error','-i',saved.path,'-f','null','-']);const info=await s.media.probe(saved.path),audio=info.streams.find(v=>v.codec_type==='audio');assert.equal(audio.channels,1);assert.equal(audio.sample_rate,'24000');assert.deepEqual(s.store.draft(),before);checks.push('真实WebM解码并转24kHz单声道，任务及配音引用不变');
  const baselineIds=s.store.data.assets.map(a=>a.id),save=s.store.save.bind(s.store);let failed=false;
  s.store.save=()=>{if(!failed&&s.store.data.assets.length>baselineIds.length){failed=true;throw Error('受控录音素材提交失败');}return save();};
  try{await assert.rejects(s.invoke('importRecording',payload),/素材提交失败/);}finally{s.store.save=save;}
  assert(failed);assert.deepEqual(s.store.data.assets.map(a=>a.id),baselineIds);assert.deepEqual(fs.readdirSync(s.store.assetDir).sort(),baselineIds.map(id=>id+'.wav').sort());assert.deepEqual(fs.readdirSync(s.store.outputDir()),[]);assert.deepEqual(JSON.parse(fs.readFileSync(s.store.file,'utf8')).assets.map(a=>a.id),baselineIds);checks.push('实际转换后素材提交失败回滚引用与文件，无未提交录音和临时目录');
  const retry=await s.invoke('importRecording',payload);assert(retry.id!==saved.id);assert.equal(s.store.data.assets.length,2);checks.push('解除提交故障后同一录音数据可实际重试');
  const report={checkedAt:new Date().toISOString(),checks,stream:{sampleRate:audio.sample_rate,channels:audio.channels,codec:audio.codec_name},duration:saved.duration,sha256:crypto.createHash('sha256').update(fs.readFileSync(saved.path)).digest('hex'),modelRequests:0,physicalMicrophoneRecorded:false,workspaceCleaned:true};fs.writeFileSync(path.join(root,'media-service-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{fs.rmSync(workspace,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
