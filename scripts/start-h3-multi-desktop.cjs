const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const {spawn,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'evidence/validation/h3-multi-generation'),workspace=path.join(directory,'workspace');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write=(name,value)=>fs.writeFileSync(path.join(directory,name),JSON.stringify(value,null,2));

async function main(){
 fs.mkdirSync(directory,{recursive:true});const resume=process.argv.includes('--resume'),seedOnly=process.argv.includes('--seed-only');
 const sourceFile=path.join(root,'evidence/validation/local-generation/workspace/studio.json'),originalFile=path.join(root,'evidence/validation/pip-desktop-workspace/studio.json');
 const protectedFiles=[sourceFile,originalFile].map(file=>({file,sha256:hash(file)}));
 if(!resume&&!seedOnly){
  if(fs.existsSync(path.join(workspace,'studio.json')))throw Error('已有多镜头验收记录，禁止重置；请使用--resume查询原任务');
  // 数据准备进程先退出，避免桌面进程与准备进程同时持有工作区。
  const result=spawnSync(process.execPath,[__filename,'--seed-only'],{cwd:root,env:process.env,windowsHide:true,encoding:'utf8'});
  if(result.status!==0)throw Error('准备多镜头输入失败：'+result.stderr);
 }
 if(seedOnly){
  if(fs.existsSync(path.join(workspace,'studio.json')))throw Error('已有验收工作区，不能重新初始化');
  const source=JSON.parse(fs.readFileSync(sourceFile,'utf8')),{Store,createDraft}=require('../server/store.cjs'),{Media,runProcess}=require('../server/media.cjs');
  const store=new Store(workspace),media=new Media(store),draft=createDraft(),sourceDraft=source.drafts.find(item=>item.id===source.currentId);
  const shape=source.avatars.find(item=>item.id===sourceDraft.video.avatarId),input=source.assets.find(item=>item.id===shape.assetId);
  if(!input||!fs.existsSync(input.path))throw Error('缺少已有自主生成的H3人物输入');
  draft.title='本地H3双镜头真实生成验收';draft.step=3;draft.confirmed=true;
  draft.finalText='先把台灯放在桌子左边，再打开开关。调整灯头，让光线照在书本上。';draft.voice.speed=1;
  store.data={...source,currentId:draft.id,drafts:[draft],avatars:[],runs:[],workflowJobs:[],publishRecords:[],settings:{...source.settings,view:'new',outputDir:path.join(workspace,'outputs'),provider:{...source.settings.provider,ttsProtocol:'windows',avatarProtocol:'comfy-h3',avatarUrl:'http://127.0.0.1:18191'}}};
  const middle=store.addAsset(input.path,{name:'自主生成人物-中景.mp4',origin:'h3-multi-input-reference',sourceSha256:hash(input.path)}),closeFile=path.join(store.outputDir(),'close-input.mp4');
  await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',input.path,'-an','-vf','crop=iw*0.8:ih*0.8:(iw-ow)/2:(ih-oh)/2,scale=608:1056','-c:v','libx264','-preset','fast','-crf','18',closeFile]);
  const close=store.addAsset(closeFile,{name:'自主生成人物-近景裁切输入.mp4',origin:'h3-multi-cropped-input',sourceSha256:hash(input.path)});
  store.data.avatars=[{id:crypto.randomUUID(),name:'本轮中景输入',assetId:middle.id},{id:crypto.randomUUID(),name:'本轮近景输入',assetId:close.id}];draft.video.avatarId=store.data.avatars[0].id;
  const {WindowsSpeech}=require('../server/windows-speech.cjs'),speech=new WindowsSpeech(store,media),voice=(await speech.voices()).find(item=>item.culture==='zh-CN');
  if(!voice)throw Error('没有已安装的中文系统音色');store.data.settings.provider.systemVoice=voice.name;store.save();
  const audio=await speech.synthesize(draft);draft.voice.audioId=audio.id;store.save();
  for(const [i,asset]of [middle,close].entries())await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',asset.path,'-frames:v','1','-update','1',path.join(directory,'input-'+i+'.png')]);
  write('inputs.json',{at:new Date().toISOString(),draftId:draft.id,sourceFile,sourceVideo:input.path,sourceVideoSha256:hash(input.path),source:'已有自主生成H3人物，仅作为模型输入；近景输入由裁切制作，不是本轮模型输出',avatars:store.data.avatars,referenceAssets:[middle,close].map(item=>({id:item.id,path:item.path,sha256:hash(item.path)})),audio:{id:audio.id,path:audio.path,duration:audio.duration,sha256:hash(audio.path),voice:voice.name,origin:'本轮新生成的Windows系统配音，非声音克隆'},text:draft.finalText,qualityAccepted:false});
  return;
 }
 const inputs=JSON.parse(fs.readFileSync(path.join(directory,'inputs.json'),'utf8')),saved=JSON.parse(fs.readFileSync(path.join(workspace,'studio.json'),'utf8'));
 if(!saved.drafts.some(item=>item.id===inputs.draftId)||hash(inputs.audio.path)!==inputs.audio.sha256||inputs.referenceAssets.some(item=>hash(item.path)!==item.sha256))throw Error('验收输入已变化，未启动');
 const callsFile=path.join(directory,'http-calls.json'),calls=fs.existsSync(callsFile)?JSON.parse(fs.readFileSync(callsFile,'utf8')):[];
 const proxy=http.createServer(async(req,res)=>{
  const call={at:new Date().toISOString(),method:req.method,url:req.url};calls.push(call);write('http-calls.json',calls);
  try{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
   if(req.url==='/prompt'&&body.length){const payload=JSON.parse(body);call.clientId=payload.client_id;call.graphSha256=require('../server/comfy-h3.cjs').graphSignature(payload.prompt);}
   const upstream=await fetch('http://127.0.0.1:8188'+req.url,{method:req.method,headers:body.length?{'Content-Type':req.headers['content-type']||'application/octet-stream'}:{},...(body.length?{body}:{})});
   const result=Buffer.from(await upstream.arrayBuffer());call.httpStatus=upstream.status;
   if(req.url==='/prompt')try{call.promptId=JSON.parse(result).prompt_id;}catch{}
   write('http-calls.json',calls);res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('Content-Type')||'application/octet-stream'});res.end(result);
  }catch(error){call.error=error.message;write('http-calls.json',calls);res.writeHead(502);res.end(JSON.stringify({error:error.message}));}
 });
 proxy.on('error',error=>{console.error(error);process.exitCode=1;});await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(18191,'127.0.0.1',resolve);});
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
 const child=spawn(require('electron'),[__filename,'--remote-debugging-port=9340','--studio-data-dir='+workspace],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 write(resume?'relaunch.json':'launch.json',{at:new Date().toISOString(),pid:child.pid,port:9340,proxyPort:18191,workspace,protectedFiles,resume});
 const log=fs.createWriteStream(path.join(directory,'electron.log'),{flags:'a'});child.stdout.pipe(log);child.stderr.pipe(log);console.log(JSON.stringify({pid:child.pid,workspace,resume}));
 child.on('exit',(code,signal)=>{write('closed.json',{at:new Date().toISOString(),code,signal,protectedFiles:protectedFiles.map(item=>({...item,unchanged:hash(item.file)===item.sha256}))});proxy.close();log.end();if(code)process.exitCode=code;});
}
if(process.versions.electron&&!process.env.ELECTRON_RUN_AS_NODE){
 require('electron').app.setPath('userData',path.join(directory,'electron-profile'));require('../electron/main.cjs');
}else main().catch(error=>{console.error(error);process.exitCode=1;});
