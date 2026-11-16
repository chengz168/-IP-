const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'evidence/validation/render-stability-20261115'),workspace=path.join(directory,'desktop-workspace');
if(process.versions.electron&&!process.env.ELECTRON_RUN_AS_NODE){
 const {app}=require('electron');app.setPath('userData',path.join(directory,'desktop-profile'));
 let cycles=0;const timer=setInterval(()=>{global.gc();cycles++;},40);timer.unref();
 app.on('will-quit',()=>{clearInterval(timer);fs.writeFileSync(path.join(directory,'desktop-gc.json'),JSON.stringify({electron:process.versions.electron,forcedGcCycles:cycles},null,2));});
 fs.writeFileSync(path.join(directory,'desktop-runtime.json'),JSON.stringify({electron:process.versions.electron,pid:process.pid},null,2));
 require('../electron/main.cjs');
}else{
 fs.mkdirSync(workspace,{recursive:true});
 if(!process.argv.includes('--resume')){
  if(fs.existsSync(path.join(workspace,'studio.json')))throw Error('已有隔离桌面工作区，不能重复初始化');
  const data=JSON.parse(fs.readFileSync(path.join(root,'evidence/validation/reference-sample-20261115/workspace/studio.json'),'utf8'));
  if(data.runs.some(run=>['running','queued','unknown'].includes(run.status)))throw Error('参考工作区仍有活动任务');
  const draft=data.drafts.find(item=>item.id===data.currentId);draft.step=4;draft.edit.resultId='';data.settings.outputDir=path.join(workspace,'outputs');
  fs.writeFileSync(path.join(workspace,'studio.json'),JSON.stringify(data,null,2));
 }
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
 const child=spawn(require('electron'),['--js-flags=--expose-gc',__filename,'--remote-debugging-port=9348','--studio-data-dir='+workspace],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 fs.writeFileSync(path.join(directory,'desktop-launch.json'),JSON.stringify({pid:child.pid,port:9348,workspace},null,2));
 const log=fs.createWriteStream(path.join(directory,'desktop-electron.log'),{flags:'a'});child.stdout.pipe(log);child.stderr.pipe(log);child.on('exit',(code,signal)=>{log.end();if(code!==0||signal)process.exitCode=1;});console.log(JSON.stringify({pid:child.pid,port:9348}));
}
