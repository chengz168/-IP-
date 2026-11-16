const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const {spawn,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'evidence/validation/h3-continuity'),workspace=path.join(directory,'workspace');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write=(name,value)=>fs.writeFileSync(path.join(directory,name),JSON.stringify(value,null,2));

async function main(){
 fs.mkdirSync(directory,{recursive:true});const resume=process.argv.includes('--resume'),seedOnly=process.argv.includes('--seed-only');
 const sourceFile=path.join(root,'evidence/validation/h3-long-generation/workspace/studio.json');
 const source=JSON.parse(fs.readFileSync(sourceFile,'utf8')),original=JSON.parse(fs.readFileSync(path.join(root,'evidence/validation/h3-long-generation/launch.json'),'utf8'));
 const protectedFiles=[sourceFile,original.originalFile,original.sourceFile].map(file=>({file,sha256:hash(file)}));
 if(fs.existsSync(path.join(workspace,'studio.json'))&&!resume)throw Error('已有衔接对照记录，禁止重新初始化；请沿原任务恢复');
 if(!resume&&!seedOnly){
  // 准备数据的进程先退出并释放目录锁，桌面进程随后独占同一目录。
  const seeded=spawnSync(process.execPath,[__filename,'--seed-only'],{cwd:root,env:process.env,windowsHide:true,encoding:'utf8'});
  if(seeded.status!==0)throw Error('准备衔接对照失败：'+seeded.stderr);
 }
 if(!resume&&seedOnly){
  const {createService}=require('../server/service.cjs'),{avatarContext}=require('../server/avatar-request.cjs');
  const service=createService(workspace),prior=source.runs.find(run=>run.remote?.kind==='comfy-h3-sequence-v1'),draft=structuredClone(source.drafts.find(draft=>draft.id===prior.draftId));
  if(prior.status!=='succeeded'||prior.remote.segments[0].status!=='succeeded')throw Error('原长片及首段未完成，不能创建对照');
  draft.id=crypto.randomUUID();draft.title='H3末帧衔接质量对照';draft.step=3;draft.video.assetId='';draft.edit.resultId='';
  service.store.data={...source,currentId:draft.id,drafts:[draft],runs:[],workflowJobs:[],settings:{...source.settings,outputDir:path.join(workspace,'outputs'),provider:{...source.settings.provider,avatarUrl:'http://127.0.0.1:18190'}}};service.store.save();
  const context=avatarContext(service.store,draft);let planned;
  // 明确的恢复夹具：只沿用已验证的首段，后续推理由产品继续按钮实际提交。
  try{await service.runtime.run('avatar',draft.id,{input:context.input},async ctx=>{
   planned=await service.providers.comfyH3().sequence().prepare(draft,ctx,context);
   const old=prior.remote.segments[0],first=structuredClone(old),file=path.join(planned.plan.directory,'generated-0.mp4');
   if(hash(old.output.path)!==old.output.sha256)throw Error('待沿用的首段已经变化');
   fs.copyFileSync(old.output.path,file);first.output.path=file;first.reusedFrom={runId:prior.id,planId:prior.remote.plan.id,modelId:old.remoteId,sha256:old.output.sha256};
   planned.segments[0]=first;ctx.remote(planned.plan.id,planned);ctx.progress(48,'对照夹具沿用首段，待明确提交末帧衔接的第二段');
   throw Object.assign(Error('验收夹具：首段沿用既有真实生成，第二段尚未提交，请使用继续分段生成'),{unknown:true});
  });}catch(error){if(!planned||!service.store.data.runs[0]?.remote?.segments[0]?.reusedFrom)throw error;}
  write('inputs.json',{fixtureSeededCompletedFirstSegment:true,sourceRunId:prior.id,sourceModelId:prior.remote.segments[0].remoteId,sourceFirstSha256:prior.remote.segments[0].output.sha256,
   draftId:draft.id,runId:service.store.data.runs[0].id,planId:planned.plan.id,sourceAudioReused:true,newSpeechInThisExperiment:false,qualityAccepted:false});
 }
 if(seedOnly)return;
 const calls=resume&&fs.existsSync(path.join(directory,'http-calls.json'))?JSON.parse(fs.readFileSync(path.join(directory,'http-calls.json'),'utf8')):[];
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
 await new Promise(resolve=>proxy.listen(18190,'127.0.0.1',resolve));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
 const child=spawn(require('electron'),[path.join(root,'scripts/h3-continuity-electron.cjs'),'--remote-debugging-port=9338','--studio-data-dir='+workspace],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 write(resume?'relaunch.json':'launch.json',{at:new Date().toISOString(),pid:child.pid,port:9338,proxyPort:18190,workspace,protectedFiles,resume});
 const log=fs.createWriteStream(path.join(directory,'electron.log'),{flags:'a'});child.stdout.pipe(log);child.stderr.pipe(log);console.log(JSON.stringify({pid:child.pid,workspace,resume}));
 child.on('exit',(code,signal)=>{write('closed.json',{at:new Date().toISOString(),code,signal,protectedFiles:protectedFiles.map(item=>({...item,unchanged:hash(item.file)===item.sha256}))});proxy.close();log.end();if(code)process.exitCode=code;});
}
main().catch(error=>{console.error(error);process.exitCode=1;});
