const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createService}=require('../server/service.cjs');
const {runProcess}=require('../server/media.cjs');

async function main(){
  const directory=path.resolve('evidence/validation/local-asr'),service=createService(path.join(directory,'failure-workspace'));
  const source=JSON.parse(fs.readFileSync('evidence/validation/pip-desktop-workspace/studio.json','utf8'));
  await service.invoke('saveSettings',{outputDir:'',ffmpegPath:source.settings.ffmpegPath,ffprobePath:source.settings.ffprobePath,provider:{asrProtocol:'local-whisper',asrPythonPath:path.resolve('.research-venv/Scripts/python.exe'),asrModelPath:'C:/Users/DELL/.cache/whisper/small',asrLanguage:'zh'}});
  const before=fs.readdirSync(os.tmpdir()).filter(name=>name.startsWith('superip-asr-')).sort(),id=service.store.data.currentId,checks=[];
  async function rejects(name,work,pattern){let message;try{await work();}catch(error){message=error.message;}assert(message,name);assert.match(message,pattern);checks.push({name,error:message});}
  const ffmpeg=service.media.binaries().ffmpeg;
  const silent=path.join(directory,'silent.wav');await runProcess(ffmpeg,['-v','error','-y','-f','lavfi','-i','anullsrc=r=16000:cl=mono','-t','1.5','-c:a','pcm_s16le',silent]);
  const silentAsset=await service.importPath(silent);await rejects('真实全静音不生成占位文字',()=>service.invoke('transcribe',{id,assetId:silentAsset.id}),/没有识别到可用语音/);
  const noAudio=source.assets.find(a=>a.name==='变色动态视频.mp4');assert(noAudio);const video=await service.importPath(noAudio.path);
  await rejects('真实无音轨视频在识别前失败',()=>service.invoke('transcribe',{id,assetId:video.id}),/没有音轨/);
  await service.invoke('saveSettings',{outputDir:'',provider:{asrModelPath:path.join(directory,'missing-model')}});
  await rejects('缺失本地模型不下载、不转云端',()=>service.invoke('transcribe',{id,assetId:silentAsset.id}),/不会自动下载/);
  assert(service.store.data.runs.every(r=>r.status==='failed'&&!r.output));assert.deepEqual(service.store.draft(id).edit.captions,[]);
  assert.deepEqual(fs.readdirSync(os.tmpdir()).filter(name=>name.startsWith('superip-asr-')).sort(),before);
  const report={checkedAt:new Date().toISOString(),checks,temporaryFilesCleaned:true,runs:service.store.data.runs};fs.writeFileSync(path.join(directory,'failure-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({checks,temporaryFilesCleaned:true},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
