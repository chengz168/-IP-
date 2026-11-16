const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),evidence=path.join(root,'evidence/validation/h3-submit-discovery');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write=(name,value)=>fs.writeFileSync(path.join(evidence,name),JSON.stringify(value,null,2));
const sourceFile=path.join(root,'evidence/validation/local-generation/workspace/studio.json');
const originalFile=path.join(root,'evidence/validation/pip-desktop-workspace/studio.json');
const workspace=path.join(evidence,'workspace');
fs.mkdirSync(evidence,{recursive:true});
const resume=process.argv.includes('--resume');
if(fs.existsSync(path.join(workspace,'studio.json'))&&!resume)throw Error('验收工作区已经存在，请使用--resume继续原夹具，不自动重建');
const source=JSON.parse(fs.readFileSync(sourceFile,'utf8'));
const reference=source.runs.find(run=>run.id==='53c0688e-9c11-4f1f-b943-a7ffbeb3c2ba');
if(!reference?.remote?.graph||reference.status!=='succeeded')throw Error('缺少已完成的真实H3产品任务');
const {graphSignature}=require('../server/comfy-h3.cjs');
const draft=structuredClone(source.drafts.find(item=>item.id===reference.draftId));
draft.id=crypto.randomUUID();draft.title='H3无ID恢复验收（故障记录夹具）';draft.video.assetId='';
source.currentId=draft.id;source.drafts=[draft];source.runs=[];
source.settings.outputDir=path.join(workspace,'outputs');
// 只读代理访问真实Comfy历史，拒绝任何提交或取消请求，并记录实际方法与路径。
const calls=resume&&fs.existsSync(path.join(evidence,'http-calls.json'))?JSON.parse(fs.readFileSync(path.join(evidence,'http-calls.json'),'utf8')):[];
const proxy=http.createServer(async(req,res)=>{
 calls.push({at:new Date().toISOString(),method:req.method,url:req.url});write('http-calls.json',calls);
 if(req.method!=='GET'){res.writeHead(405);res.end('本验收代理只允许GET');return;}
 try{const upstream=await fetch('http://127.0.0.1:8188'+req.url);res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('Content-Type')||'application/octet-stream'});res.end(Buffer.from(await upstream.arrayBuffer()));}
 catch(error){res.writeHead(502);res.end(error.message);}
});
proxy.listen(18188,'127.0.0.1',()=>{
 source.settings.provider.avatarUrl='http://127.0.0.1:18188';
 const storeView={data:source,asset:id=>source.assets.find(item=>item.id===id)};
 const input=require('../server/avatar-request.cjs').avatarContext(storeView,draft).input;
 const run={...structuredClone(reference),id:crypto.randomUUID(),draftId:draft.id,status:'unknown',remoteId:'',progress:12,
  error:'故障记录夹具：模拟提交凭据已保存但任务ID未落盘；未制造实际网络丢包。',parameters:{...reference.parameters,input},snapshot:structuredClone(draft),
  remote:{...reference.remote,baseUrl:'http://127.0.0.1:18188',statusUrl:'http://127.0.0.1:18188/history',clientId:reference.remote.graph['16'].inputs.filename_prefix.split('/').at(-1),graphSha256:graphSignature(reference.remote.graph),submissionState:'submitting'}};
 for(const key of ['output','remoteResolution','remoteChecks','unresolvedHistory'])delete run[key];
 source.runs=[run];fs.mkdirSync(workspace,{recursive:true});
 if(resume){const saved=JSON.parse(fs.readFileSync(path.join(workspace,'studio.json'),'utf8'));Object.assign(run,saved.runs[0]);Object.assign(draft,saved.drafts[0]);}
 else fs.writeFileSync(path.join(workspace,'studio.json'),JSON.stringify(source,null,2));
 const receipt={at:new Date().toISOString(),fixture:true,newGeneration:false,realComfyHistory:true,runId:run.id,draftId:draft.id,expectedPromptId:reference.remoteId,
  workspace,originalFile,originalSha256:hash(originalFile),sourceFile,sourceSha256:hash(sourceFile),port:9336,proxyPort:18188};
 const electronEnv={...process.env};delete electronEnv.ELECTRON_RUN_AS_NODE;
 const child=spawn(require('electron'),[path.join(root,'scripts/h3-discovery-electron.cjs'),'--remote-debugging-port=9336','--studio-data-dir='+workspace],{cwd:root,windowsHide:true,env:electronEnv,stdio:['ignore','pipe','pipe']});
 receipt.pid=child.pid;write('launch.json',receipt);
 const log=fs.createWriteStream(path.join(evidence,'electron.log'),{flags:'a'});child.stdout.pipe(log);child.stderr.pipe(log);
 console.log(JSON.stringify(receipt));
 child.on('exit',(code,signal)=>{write('closed.json',{at:new Date().toISOString(),code,signal,originalUnchanged:hash(originalFile)===receipt.originalSha256,sourceUnchanged:hash(sourceFile)===receipt.sourceSha256,calls: calls.length,onlyGet:calls.every(call=>call.method==='GET')});if(code)process.exitCode=code;proxy.close();log.end();});
});
