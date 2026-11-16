const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const os=require('node:os');
const {createService}=require('../server/service.cjs');

// 复用本机已有模型和隔离素材，不改用户原有任务或下载模型。
async function main(){
  const directory=path.resolve('evidence/validation/local-asr');fs.mkdirSync(directory,{recursive:true});
  const service=createService(path.join(directory,'workspace')),state=JSON.parse(fs.readFileSync('data/studio.json','utf8'));
  const source=state.assets.find(asset=>asset.name==='收纳盒商品推广视频_19s.mp4');assert(source,'已有19秒有声视频');
  const report={checkedAt:new Date().toISOString(),source:source.path,assertions:[],events:[]};
  const tempDirs=()=>fs.readdirSync(os.tmpdir()).filter(name=>name.startsWith('superip-asr-')).sort();const before=tempDirs();
  const id=service.store.data.currentId;
  await service.invoke('saveSettings',{outputDir:'',ffmpegPath:state.settings.ffmpegPath,ffprobePath:state.settings.ffprobePath,provider:{asrProtocol:'local-whisper',asrPythonPath:path.resolve('.research-venv/Scripts/python.exe'),asrModelPath:'C:\\Users\\DELL\\.cache\\whisper\\small',asrLanguage:'zh'}});
  const checked=await service.invoke('checkLocalAsr');assert(checked.available);report.environment=checked;console.log(JSON.stringify({event:'model-loaded',...checked}));
  const asset=await service.importPath(source.path),started=Date.now();
  try{
    const result=await service.invoke('transcribe',{id,assetId:asset.id});
    assert(result.text.trim());assert(result.segments.length);assert(result.segments.every(row=>row.start>=0&&row.end>row.start&&row.end<=result.duration));
    report.elapsedMs=Date.now()-started;report.result=result;
    const draft=structuredClone(service.store.draft(id));draft.edit.sourceId=asset.id;draft.edit.captions=result.segments;await service.invoke('saveDraft',draft);
    const srt=await service.invoke('exportCaptions',{id});assert(fs.readFileSync(srt.file,'utf8').includes(result.segments[0].text));report.srt=srt;
    const runs=service.store.data.runs;report.runs=runs.map(run=>({id:run.id,status:run.status,logs:run.logs}));
    assert.deepEqual(tempDirs(),before);report.assertions.push('真实本地识别、有效时间轴、保存和SRT导出、临时目录清理');
    console.log(JSON.stringify({elapsedMs:report.elapsedMs,text:result.text,segments:result.segments.length}));
    fs.writeFileSync(path.join(directory,'backend-report.json'),JSON.stringify(report,null,2));
  }catch(e){report.error=e.message;fs.writeFileSync(path.join(directory,'backend-report.json'),JSON.stringify(report,null,2));throw e;}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
