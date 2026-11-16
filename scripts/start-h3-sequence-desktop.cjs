const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),evidence=path.join(root,'evidence/validation/h3-long-generation'),workspace=path.join(evidence,'workspace');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write=(name,value)=>fs.writeFileSync(path.join(evidence,name),JSON.stringify(value,null,2));
const sourceFile=path.join(root,'evidence/validation/local-generation/workspace/studio.json'),originalFile=path.join(root,'evidence/validation/pip-desktop-workspace/studio.json');

async function main(){
 fs.mkdirSync(evidence,{recursive:true});const resume=process.argv.includes('--resume');
 if(fs.existsSync(path.join(workspace,'studio.json'))&&!resume)throw Error('已有长片验收工作区，先检查原任务，使用--resume继续，禁止重新初始化');
 if(!resume){
  const saved=JSON.parse(fs.readFileSync(sourceFile,'utf8')),{Store,createDraft}=require('../server/store.cjs'),store=new Store(workspace);
  const draft=createDraft();draft.title='H3长片真实生成验收';draft.step=2;
  draft.finalText='先把台灯放在桌子左边，接好电源后，再打开开关。调整灯头，让光线照在书本上，避免直接照向眼睛。最后检查桌面是否稳定，再开始阅读。';
  draft.confirmed=true;draft.voice.speed=1;draft.video.avatarId=saved.drafts.find(item=>item.id===saved.currentId).video.avatarId;
  store.data={...saved,currentId:draft.id,drafts:[draft],runs:[],workflowJobs:[],publishRecords:[],settings:{...saved.settings,view:'new',outputDir:path.join(workspace,'outputs'),provider:{...saved.settings.provider,ttsProtocol:'windows',avatarProtocol:'comfy-h3',avatarUrl:'http://127.0.0.1:18189'}}};
  const {WindowsSpeech}=require('../server/windows-speech.cjs'),{Media}=require('../server/media.cjs');
  const installed=await new WindowsSpeech(store,new Media(store)).voices(),voice=installed.find(item=>item.culture==='zh-CN');if(!voice)throw Error('没有可用的中文系统音色，不伪造配音');
  store.data.settings.provider.systemVoice=voice.name;store.save();write('inputs.json',{draftId:draft.id,text:draft.finalText,voice,voiceSource:'windows-system-new-synthesis',avatarId:draft.video.avatarId,avatarSource:'first-own-h3-generation',qualityAccepted:false});
 }
 const calls=resume&&fs.existsSync(path.join(evidence,'http-calls.json'))?JSON.parse(fs.readFileSync(path.join(evidence,'http-calls.json'),'utf8')):[];
 const proxy=http.createServer(async(req,res)=>{
  const call={at:new Date().toISOString(),method:req.method,url:req.url};calls.push(call);write('http-calls.json',calls);
  try{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
   if(req.url==='/prompt'&&body.length){const payload=JSON.parse(body.toString());call.clientId=payload.client_id;call.graphSha256=require('../server/comfy-h3.cjs').graphSignature(payload.prompt);}
   const upstream=await fetch('http://127.0.0.1:8188'+req.url,{method:req.method,headers:body.length?{'Content-Type':req.headers['content-type']||'application/octet-stream'}:{},...(body.length?{body}:{})});
   const result=Buffer.from(await upstream.arrayBuffer());call.httpStatus=upstream.status;
   if(req.url==='/prompt')try{call.promptId=JSON.parse(result.toString()).prompt_id;}catch{}
   write('http-calls.json',calls);res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('Content-Type')||'application/octet-stream'});res.end(result);
  }catch(error){call.error=error.message;write('http-calls.json',calls);res.writeHead(502);res.end(JSON.stringify({error:error.message}));}
 });
 await new Promise(resolve=>proxy.listen(18189,'127.0.0.1',resolve));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
 const child=spawn(require('electron'),[path.join(root,'scripts/h3-sequence-electron.cjs'),'--remote-debugging-port=9337','--studio-data-dir='+workspace],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 const receipt={at:new Date().toISOString(),pid:child.pid,workspace,port:9337,proxyPort:18189,originalFile,originalSha256:hash(originalFile),sourceFile,sourceSha256:hash(sourceFile),resume};
 write(resume?'relaunch.json':'launch.json',receipt);const log=fs.createWriteStream(path.join(evidence,'electron.log'),{flags:'a'});child.stdout.pipe(log);child.stderr.pipe(log);console.log(JSON.stringify(receipt));
 child.on('exit',(code,signal)=>{write('closed.json',{at:new Date().toISOString(),code,signal,originalUnchanged:hash(originalFile)===receipt.originalSha256,sourceUnchanged:hash(sourceFile)===receipt.sourceSha256});if(code)process.exitCode=code;proxy.close();log.end();});
}
main().catch(error=>{console.error(error);process.exitCode=1;});
