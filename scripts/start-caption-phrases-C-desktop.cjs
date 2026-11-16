// 隔离复用已生成C视频，只重新识别和剪辑，不改正式工作区。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {Store}=require('../server/store.cjs'),{digest}=require('../integrations/musetalk-local/input.cjs');
const root=path.resolve(__dirname,'../evidence/validation/caption-phrases-C-20261116'),workspace=path.join(root,'workspace');
const write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2),{flag:'wx'});
function seed(){
 assert(!fs.existsSync(workspace),'保留既有隔离工作区');
 const oldStatePath=path.resolve(root,'../musetalk-integration-20261115/workspace/studio.json'),old=JSON.parse(fs.readFileSync(oldStatePath,'utf8'));
 const priorRun=old.runs.find(run=>run.id==='c7220fe7-ae3c-4d57-8f16-2cb4a8f13d18'),priorDraft=old.drafts.find(draft=>draft.id===priorRun.draftId),source=old.assets.find(asset=>asset.id===priorRun.output.sourceAssetId);
 assert.equal(source.lipSync.drivingAudioId,'59017ac9-ab15-4d45-95d7-8e914dec7842','源素材必须是原C驱动');
 assert.equal(digest(source.path),source.lipSync.outputSha256);
 const protections=JSON.parse(fs.readFileSync(path.resolve(root,'../musetalk-long-20261116/protected-files-check.json'),'utf8')).files.map(item=>({file:item.file,sha256:item.expected}));
 protections.push({file:oldStatePath,sha256:digest(oldStatePath)},{file:source.path,sha256:digest(source.path)});
 assert(protections.every(item=>digest(item.file)===item.sha256));
 write('baseline.json',{at:new Date().toISOString(),protectedFiles:protections});
 const store=new Store(workspace);
 store.data.settings={...store.data.settings,...structuredClone(old.settings),view:'new',mode:'own',outputDir:path.join(workspace,'outputs')};
 const asset=store.addAsset(source.path,{name:'原C音色-已生成口型.mp4',origin:'caption-phrase-reference',duration:source.duration});
 assert.equal(digest(asset.path),digest(source.path));
 const draft=store.draft();
 Object.assign(draft,{title:'C样片字幕短语断句验证',step:4,mode:'manual',sourceText:priorDraft.finalText,rewrite:priorDraft.finalText,finalText:priorDraft.finalText,confirmed:true});
 Object.assign(draft.edit,structuredClone(priorDraft.edit),{sourceId:asset.id,resultId:'',captions:[]});
 store.save();
 write('prepared.json',{at:new Date().toISOString(),draftId:draft.id,workspace,source:{id:asset.id,path:asset.path,sha256:digest(asset.path),originalId:source.id,originalPath:source.path,duration:asset.duration},text:draft.finalText,previousCaptions:priorDraft.edit.captions,asr:{protocol:store.data.settings.provider.asrProtocol,python:store.data.settings.provider.asrPythonPath,model:store.data.settings.provider.asrModelPath},newSpeechGenerated:false,newLipSyncGenerated:false});
 console.log(JSON.stringify({seeded:true,draftId:draft.id,sourceId:asset.id,protectedFiles:protections.length}));
}
async function launch(){
 assert(fs.existsSync(path.join(root,'prepared.json')),'请先准备隔离工作区');
 assert(!fs.existsSync(path.join(root,'launch.json')),'不重复启动隔离窗口');
 let occupied=false;try{occupied=(await fetch('http://127.0.0.1:9372/json/version')).ok}catch{}
 assert(!occupied,'端口9372已占用，请核对现有窗口');
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
 const log=fs.openSync(path.join(root,'electron.log'),'a');
 const child=spawn(require('electron'),[__filename,'--remote-debugging-port=9372','--studio-data-dir='+workspace],{cwd:path.resolve(__dirname,'..'),env,windowsHide:true,detached:true,stdio:['ignore',log,log]});
 child.unref();fs.closeSync(log);
 write('launch.json',{at:new Date().toISOString(),pid:child.pid,port:9372,workspace,packagedExeStarted:false});
 console.log(JSON.stringify({pid:child.pid,port:9372}));
}
if(process.versions.electron&&!process.env.ELECTRON_RUN_AS_NODE){require('electron').app.setPath('userData',path.join(root,'electron-profile'));require('../electron/main.cjs');}
else Promise.resolve().then(()=>process.argv.includes('--seed-only')?seed():launch()).catch(error=>{console.error(error);process.exitCode=1});
