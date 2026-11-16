const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'evidence/validation/indextts-readiness'),workspace=path.join(directory,'workspace');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write=(name,value)=>fs.writeFileSync(path.join(directory,name),JSON.stringify(value,null,2));
if(process.versions.electron&&!process.env.ELECTRON_RUN_AS_NODE){
 require('electron').app.setPath('userData',path.join(directory,'electron-profile'));require('../electron/main.cjs');
}else{
 fs.mkdirSync(directory,{recursive:true});
 const protectedFiles=['data/studio.json','evidence/validation/local-generation/workspace/studio.json','evidence/validation/pip-desktop-workspace/studio.json','evidence/validation/h3-multi-generation/workspace/studio.json'].map(file=>path.join(root,file)).filter(file=>fs.existsSync(file)).map(file=>({file,sha256:hash(file)}));
 if(!fs.existsSync(path.join(workspace,'studio.json'))){
  const {Store}=require('../server/store.cjs'),store=new Store(workspace);
  // 只使用独立空任务和本地服务设置，不复制业务素材或模型密钥。
  store.data.settings.provider={...store.data.settings.provider,ttsProtocol:'indextts-local',indexttsHome:'D:/AI-Runtimes/super-ip/indextts-2.5',avatarProtocol:'comfy-h3',avatarUrl:'http://127.0.0.1:8188'};store.save();
 }
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
 const child=spawn(require('electron'),[__filename,'--remote-debugging-port=9341','--studio-data-dir='+workspace],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 write('launch.json',{at:new Date().toISOString(),pid:child.pid,port:9341,workspace,protectedFiles});
 const log=fs.createWriteStream(path.join(directory,'electron.log'),{flags:'a'});child.stdout.pipe(log);child.stderr.pipe(log);
 console.log(JSON.stringify({pid:child.pid,workspace,port:9341}));
 child.on('exit',(code,signal)=>{write('closed.json',{at:new Date().toISOString(),code,signal,protectedFiles:protectedFiles.map(item=>({...item,unchanged:hash(item.file)===item.sha256}))});log.end();if(code)process.exitCode=code;});
}
