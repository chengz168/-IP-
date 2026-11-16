// 只读复制业务快照，用独立窗口验证C音色轻情绪，避免污染正式数据。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const root=path.resolve('evidence/validation/voice-C-emotion-20261116'),workspace=path.join(root,'workspace'),original=path.resolve('evidence/validation/musetalk-integration-20261115/workspace/studio.json');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8')),hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2),{flag:'wx'});
async function main(){
 assert(!fs.existsSync(path.join(root,'launch.json')),'已有启动凭据，须先检查PID和端口');
 let occupied=false;try{occupied=(await fetch('http://127.0.0.1:9358/json/version')).ok;}catch{}assert(!occupied,'验证端口已占用');
 const source=read(original);assert(!source.runs.some(r=>['running','queued','unknown'].includes(r.status)));assert(!(source.workflowJobs||[]).some(j=>['running','queued','stopping'].includes(j.status)));
 const protectedFiles=read('evidence/validation/musetalk-integration-20261115/prepared.json').protectedFiles.map(item=>({file:item.file,sha256:hash(item.file)}));
 fs.mkdirSync(workspace,{recursive:true});assert(!fs.existsSync(path.join(workspace,'studio.json')),'已有验证数据，不重新播种');
 write('baseline.json',{at:new Date().toISOString(),original,originalSha256:hash(original),currentId:source.currentId,protectedFiles});
 source.settings.outputDir=path.join(workspace,'outputs');fs.writeFileSync(path.join(workspace,'studio.json'),JSON.stringify(source,null,2),{flag:'wx'});
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
 const log=fs.openSync(path.join(root,'electron.log'),'a'),child=spawn(require('electron'),[__filename,'--remote-debugging-port=9358','--studio-data-dir='+workspace],{cwd:process.cwd(),env,windowsHide:true,detached:true,stdio:['ignore',log,log]});child.unref();fs.closeSync(log);
 write('launch.json',{at:new Date().toISOString(),pid:child.pid,port:9358,workspace,sourceElectron:true,seededFromReadOnlySnapshot:true});
 for(let n=0;n<150;n++){try{if((await fetch('http://127.0.0.1:9358/json/version')).ok){console.log(JSON.stringify({pid:child.pid,port:9358,workspace}));return;}}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('启动观察超时，保留原PID凭据，不自动重启');
}
if(process.versions.electron&&!process.env.ELECTRON_RUN_AS_NODE){require('electron').app.setPath('userData',path.join(root,'electron-profile'));require('../electron/main.cjs');}
else main().catch(error=>{console.error(error);process.exitCode=1;});
