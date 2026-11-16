const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const {spawn,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'evidence/validation/indextts-h3-chain'),workspace=path.join(directory,'workspace');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write=(file,value)=>fs.writeFileSync(path.join(directory,file),JSON.stringify(value,null,2));
async function main(){
 fs.mkdirSync(directory,{recursive:true});const seed=process.argv.includes('--seed-only'),resume=process.argv.includes('--resume');
 if(seed){
  if(fs.existsSync(path.join(workspace,'studio.json')))throw Error('已有本批数据，禁止重新准备');
  const voiceDirectory=path.join(root,'evidence/validation/indextts-generation'),voiceFile=path.join(voiceDirectory,'workspace/studio.json');
  const voices=JSON.parse(fs.readFileSync(voiceFile,'utf8')),normal=JSON.parse(fs.readFileSync(path.join(voiceDirectory,'normal-output/report.json'),'utf8'));
  if(voices.runs.some(run=>['running','queued','cancelling'].includes(run.status)))throw Error('声音推理尚未结束，不能同时启动H3');
  if(!normal.asrTextMatchesInput||normal.nativeSignal.fullScaleSamples!==0||normal.audioMastering.policy!=='vocoder-before-limit-peak-0.95-v2')throw Error('正常配音尚未通过本批技术检查');
  const voiceRun=voices.runs.find(run=>run.id===normal.runId),audio=voices.assets.find(asset=>asset.id===voiceRun?.output?.id);
  if(voiceRun?.status!=='succeeded'||!audio||hash(audio.path)!==normal.sha256)throw Error('已核验声音产物不一致');
  const sourceFile=path.join(root,'evidence/validation/local-generation/workspace/studio.json'),source=JSON.parse(fs.readFileSync(sourceFile,'utf8'));
  const sourceDraft=source.drafts.find(draft=>draft.id===source.currentId),avatar=source.avatars.find(item=>item.id===sourceDraft.video.avatarId),video=source.assets.find(item=>item.id===avatar?.assetId);
  if(!avatar||!video||video.id!=='d91e0a31-17c5-4e0c-8d37-a1970805f113')throw Error('缺少已核验的自主H3虚构人物参考');
  const {Store,createDraft}=require('../server/store.cjs'),store=new Store(workspace),draft=createDraft();
  draft.title='本地参考配音到H3实际生成';draft.step=3;draft.confirmed=true;draft.finalText=voiceRun.parameters.input.text;draft.mode='manual';
  draft.voice={...voices.drafts.find(item=>item.id===voiceRun.draftId).voice,speed:1,emotion:'',audioId:audio.id};
  draft.video={...draft.video,mode:'single',avatarId:avatar.id,audioId:'',assetId:'',shots:[]};
  store.data={...source,currentId:draft.id,drafts:[draft],assets:[...source.assets,...voices.assets],avatars:[structuredClone(avatar)],voices:structuredClone(voices.voices),runs:[],workflowJobs:[],publishRecords:[],settings:{...source.settings,view:'new',outputDir:path.join(workspace,'outputs'),provider:{...voices.settings.provider,avatarProtocol:'comfy-h3',avatarUrl:'http://127.0.0.1:18192'}}};
  store.save();
  const protectedFiles=JSON.parse(fs.readFileSync(path.join(voiceDirectory,'inputs.json'),'utf8')).protectedFiles;
  if(protectedFiles.some(item=>hash(item.file)!==item.sha256))throw Error('原业务文件发生变化，不能继续本批');
  write('inputs.json',{at:new Date().toISOString(),draftId:draft.id,text:draft.finalText,audio:{id:audio.id,path:audio.path,sha256:hash(audio.path),duration:audio.duration,runId:voiceRun.id,origin:audio.origin},reference:{avatarId:avatar.id,path:video.path,sha256:hash(video.path),origin:'此前自主H3虚构人物，仅作首帧输入'},protectedFiles:[...protectedFiles,{file:voiceFile,sha256:hash(voiceFile)}],newModelSubmissions:0,qualityAccepted:false,completeReplica:false});
  console.log(JSON.stringify({seeded:true,draftId:draft.id,audioRun:voiceRun.id}));return;
 }
 if(!resume){
  const seeded=spawnSync(process.execPath,[__filename,'--seed-only'],{cwd:root,encoding:'utf8',windowsHide:true});
  if(seeded.status!==0)throw Error('准备失败：'+seeded.stderr);
 }
 const inputs=JSON.parse(fs.readFileSync(path.join(directory,'inputs.json'),'utf8'));
 if(hash(inputs.audio.path)!==inputs.audio.sha256||hash(inputs.reference.path)!==inputs.reference.sha256)throw Error('原输入已变化，停止启动');
 const callsFile=path.join(directory,'http-calls.json'),calls=fs.existsSync(callsFile)?JSON.parse(fs.readFileSync(callsFile,'utf8')):[];
 const proxy=http.createServer(async(req,res)=>{
  const call={at:new Date().toISOString(),method:req.method,url:req.url};calls.push(call);write('http-calls.json',calls);
  try{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
   if(req.url==='/prompt'&&body.length){const payload=JSON.parse(body);call.clientId=payload.client_id;call.graphSha256=require('../server/comfy-h3.cjs').graphSignature(payload.prompt);write('http-calls.json',calls);}
   const response=await fetch('http://127.0.0.1:8188'+req.url,{method:req.method,headers:body.length?{'Content-Type':req.headers['content-type']||'application/octet-stream'}:{},...(body.length?{body}:{})});
   const result=Buffer.from(await response.arrayBuffer());call.httpStatus=response.status;if(req.url==='/prompt')try{call.promptId=JSON.parse(result).prompt_id;}catch{}
   write('http-calls.json',calls);res.writeHead(response.status,{'Content-Type':response.headers.get('Content-Type')||'application/octet-stream'});res.end(result);
  }catch(error){call.error=error.message;write('http-calls.json',calls);res.writeHead(502);res.end(JSON.stringify({error:error.message}));}
 });
 await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(18192,'127.0.0.1',resolve);});
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
 const child=spawn(require('electron'),[__filename,'--remote-debugging-port=9343','--studio-data-dir='+workspace],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 write(resume?'relaunch.json':'launch.json',{at:new Date().toISOString(),pid:child.pid,port:9343,workspace,resume});
 const log=fs.createWriteStream(path.join(directory,'electron.log'),{flags:'a'});child.stdout.pipe(log);child.stderr.pipe(log);console.log(JSON.stringify({pid:child.pid,port:9343,workspace}));
 child.on('exit',(code,signal)=>{write('closed.json',{at:new Date().toISOString(),code,signal,protectedFiles:inputs.protectedFiles.map(item=>({...item,unchanged:hash(item.file)===item.sha256}))});proxy.close();log.end();if(code)process.exitCode=code;});
}
if(process.versions.electron&&!process.env.ELECTRON_RUN_AS_NODE){require('electron').app.setPath('userData',path.join(directory,'electron-profile'));require('../electron/main.cjs');}
else main().catch(error=>{console.error(error);process.exitCode=1;});
