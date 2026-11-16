const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'evidence/validation/h3-progress'),workspace=path.join(directory,'workspace');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write=(file,value)=>fs.writeFileSync(path.join(directory,file),JSON.stringify(value,null,2));
async function main(){
 fs.mkdirSync(directory,{recursive:true});const resume=process.argv.includes('--resume');
 if(!resume){
  if(fs.existsSync(path.join(workspace,'studio.json')))throw Error('已有进度验收数据，只能resume，禁止覆盖');
  const sourceDir=path.join(root,'evidence/validation/indextts-h3-chain'),sourceFile=path.join(sourceDir,'workspace/studio.json');
  const source=JSON.parse(fs.readFileSync(sourceFile,'utf8')),inputs=JSON.parse(fs.readFileSync(path.join(sourceDir,'inputs.json'),'utf8'));
  if(source.runs.some(run=>['running','queued'].includes(run.status)))throw Error('原任务仍在运行');
  if(hash(inputs.audio.path)!==inputs.audio.sha256)throw Error('正常配音已变化');
  const {Store,createDraft}=require('../server/store.cjs'),store=new Store(workspace),draft=createDraft();
  const clipped=path.join(directory,'normal-first-2.06-seconds.wav');
  const ffmpeg='F:/Software/轻语IP智能体/aigc-human/resources/ffmpeg/bin/ffmpeg.exe';
  const result=spawnSync(ffmpeg,['-v','error','-n','-i',inputs.audio.path,'-af','atrim=end=2.06,asetpts=PTS-STARTPTS','-ac','1','-ar','22050','-c:a','pcm_s16le',clipped],{encoding:'utf8',windowsHide:true});
  if(result.status!==0)throw Error(result.stderr||'裁切失败');
  const referenceDraft=source.drafts.find(item=>item.id===source.currentId);
  draft.title='H3真实进度验收';draft.step=3;draft.mode='manual';draft.confirmed=true;draft.finalText='今天我们用一个简单的方法';
  store.data={...source,currentId:draft.id,drafts:[draft],runs:[],workflowJobs:[],publishRecords:[],settings:{...source.settings,outputDir:path.join(workspace,'outputs'),provider:{...source.settings.provider,avatarUrl:'http://127.0.0.1:8188'}}};
  const audio=store.addAsset(clipped,{origin:'validation-driver-clip',duration:2.06,sourceAudioSha256:inputs.audio.sha256,start:0,end:2.06},{persist:false});
  draft.voice={...referenceDraft.voice,audioId:audio.id};draft.video={...referenceDraft.video,assetId:'',audioId:'',mode:'single',shots:[]};store.save();
  const protectedFiles=[...inputs.protectedFiles,{file:sourceFile,sha256:hash(sourceFile)}];
  for(const item of protectedFiles)if(hash(item.file)!==item.sha256)throw Error('受保护工作区已变化');
  write('inputs.json',{at:new Date().toISOString(),draftId:draft.id,reference:inputs.reference,audio:{...audio,path:audio.path,sha256:hash(audio.path),sourceRunId:inputs.audio.runId,origin:'此前正常IndexTTS产物的0至2.06秒裁切；本批未重新合成配音'},protectedFiles,qualityAccepted:false,referenceParityAccepted:false});
 }
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
 const child=spawn(require('electron'),[__filename,'--remote-debugging-port=9344','--studio-data-dir='+workspace],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 write(resume?'relaunch.json':'launch.json',{at:new Date().toISOString(),pid:child.pid,port:9344,workspace,resume});
 const log=fs.createWriteStream(path.join(directory,'electron.log'),{flags:'a'});child.stdout.pipe(log);child.stderr.pipe(log);console.log(JSON.stringify({pid:child.pid,port:9344,workspace}));
 child.on('exit',(code,signal)=>{write('closed.json',{at:new Date().toISOString(),code,signal});log.end();if(code)process.exitCode=code;});
}
if(process.versions.electron&&!process.env.ELECTRON_RUN_AS_NODE){
 require('electron').app.setPath('userData',path.join(directory,'electron-profile'));
 const realFetch=globalThis.fetch;
 // 仅记本批模型服务调用，不记录其他服务、密钥或请求正文。
 globalThis.fetch=async(input,options={})=>{
  const url=new URL(input);if(url.origin!=='http://127.0.0.1:8188')return realFetch(input,options);
  const record={at:new Date().toISOString(),method:options.method||'GET',url:url.pathname+url.search};
  try{const response=await realFetch(input,options);record.status=response.status;return response;}catch(error){record.error=error.message;throw error;}
  finally{fs.appendFileSync(path.join(directory,'http-calls.jsonl'),JSON.stringify(record)+'\n');}
 };
 write('runtime.json',{node:process.versions.node,electron:process.versions.electron,WebSocket:typeof WebSocket});
 require('../electron/main.cjs');
}else main().catch(error=>{console.error(error);process.exitCode=1;});
