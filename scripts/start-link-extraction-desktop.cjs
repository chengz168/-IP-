const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'evidence/validation/local-link-extraction'),workspace=path.join(directory,'workspace');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),write=(name,value)=>fs.writeFileSync(path.join(directory,name),JSON.stringify(value,null,2));
async function main(){
 fs.mkdirSync(directory,{recursive:true});const resume=process.argv.includes('--resume');
 if(!resume){
  if(fs.existsSync(path.join(workspace,'studio.json')))throw Error('独立提取验收数据已存在，禁止覆盖');
  const sourceFile=path.join(root,'evidence/validation/h3-progress/workspace/studio.json'),source=JSON.parse(fs.readFileSync(sourceFile,'utf8')),prior=JSON.parse(fs.readFileSync(path.join(root,'evidence/validation/h3-progress/inputs.json'),'utf8'));
  if(source.runs.some(run=>run.status==='running'))throw Error('原任务仍在执行');
  const normal=JSON.parse(fs.readFileSync(path.join(root,'evidence/validation/indextts-generation/normal-output/report.json'),'utf8'));if(hash(normal.path)!==normal.sha256)throw Error('正常声音文件不一致');
  const {Store,createDraft}=require('../server/store.cjs'),store=new Store(workspace),draft=createDraft();draft.title='本地分享链接真实识别验收';draft.step=0;draft.tab='extract';draft.sourceText='';draft.sourceUrl='分享音轨 http://127.0.0.1:18196/normal.wav。复制打开';
  store.data={...source,currentId:draft.id,drafts:[draft],runs:[],workflowJobs:[],publishRecords:[],settings:{...source.settings,view:'new',outputDir:path.join(workspace,'outputs'),provider:{...source.settings.provider,extractProtocol:'local',extractPythonPath:'C:/Python314/python.exe',extractPackagePath:'D:/AI-Runtimes/super-ip/link-extractor/2026.10.26/package'}}};store.save();
  const protectedFiles=[...prior.protectedFiles,{file:sourceFile,sha256:hash(sourceFile)}];for(const item of protectedFiles)if(hash(item.file)!==item.sha256)throw Error('受保护文件已变化');
  write('inputs.json',{at:new Date().toISOString(),fixtureMediaHttp:true,publicPlatformVerified:false,draftId:draft.id,source:{file:normal.path,sha256:normal.sha256,text:normal.request.text||'今天我们用一个简单的方法，让桌面的光线更舒服。把台灯移到左边，调整灯头，再打开开关。'},protectedFiles});
 }
 const inputs=JSON.parse(fs.readFileSync(path.join(directory,'inputs.json'),'utf8')),calls=[],sockets=new Set();
 const server=http.createServer((req,res)=>{
  calls.push({at:new Date().toISOString(),method:req.method,url:req.url});write('http-calls.json',calls);
  if(!['/normal.wav','/delayed.wav','/slow.wav'].includes(req.url)){res.writeHead(404);res.end('未找到测试音轨');return;}
  const send=()=>{if(res.destroyed)return;const bytes=fs.statSync(inputs.source.file).size;res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':bytes});fs.createReadStream(inputs.source.file).pipe(res);};
  if(req.url==='/normal.wav')send();else{const timer=setTimeout(send,req.url==='/delayed.wav'?2500:60000);res.on('close',()=>clearTimeout(timer));}
 });server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});await new Promise(resolve=>server.listen(18196,'127.0.0.1',resolve));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
 const child=spawn(require('electron'),[__filename,'--remote-debugging-port=9346','--studio-data-dir='+workspace],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});write(resume?'relaunch.json':'launch.json',{at:new Date().toISOString(),pid:child.pid,workspace,port:9346});const log=fs.createWriteStream(path.join(directory,'electron.log'),{flags:'a'});child.stdout.pipe(log);child.stderr.pipe(log);console.log(JSON.stringify({pid:child.pid,port:9346,fixtureMediaHttp:true}));
 child.on('exit',code=>{for(const socket of sockets)socket.destroy();server.close();log.end();write('closed.json',{at:new Date().toISOString(),code});if(code)process.exitCode=code;});
}
if(process.versions.electron&&!process.env.ELECTRON_RUN_AS_NODE){require('electron').app.setPath('userData',path.join(directory,'electron-profile'));require('../electron/main.cjs');}
else main().catch(error=>{console.error(error);process.exitCode=1;});
