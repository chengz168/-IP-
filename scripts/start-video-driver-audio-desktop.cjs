const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const directory=path.resolve(__dirname,'../evidence/validation/video-driver-audio'),workspace=path.join(directory,'workspace');
const write=(file,data)=>fs.writeFileSync(path.join(directory,file),JSON.stringify(data,null,2));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function main(){
 if(fs.existsSync(path.join(directory,'launch.json'))){
  if(!process.argv.includes('--relaunch')||!fs.existsSync(path.join(directory,'closed.json')))throw Error('已有本批启动记录，请先检查窗口，不能并发访问同一工作区');
  fs.copyFileSync(path.join(directory,'launch.json'),path.join(directory,'launch-before-restart-'+Date.now()+'.json'));
  fs.unlinkSync(path.join(directory,'closed.json'));
 }
 const source=path.resolve('evidence/validation/reference-video-night-20261115/workspace/studio.json'),data=JSON.parse(fs.readFileSync(source,'utf8'));
 const protectedFiles=[source,path.resolve('data/studio.json'),path.resolve('evidence/validation/reference-sample-20261115/workspace/studio.json'),'F:/Software/轻语IP智能体/aigc-human/resources/assets/videos/示例2-夜间.mp4','F:/Software/轻语IP智能体/aigc-human/outputs/videos/cloud_1794663289391.mp4'];
 write('protected-before.json',protectedFiles.map(file=>({file,sha256:hash(file)})));
 const draft=structuredClone(data.drafts.find(item=>item.id===data.currentId));draft.id=crypto.randomUUID();draft.title='示例二 · 驱动音频试听验收';draft.step=3;draft.mode='manual';
 draft.video.audioId='';draft.voice.audioId='e0d85479-a859-4174-9756-ccff45442a22';
 if(!data.assets.some(asset=>asset.id===draft.voice.audioId))throw Error('真实8秒驱动音频未在源资产中登记');
 const second=structuredClone(draft);second.id=crypto.randomUUID();second.title='切任务停止试听';
 fs.mkdirSync(workspace,{recursive:true});fs.writeFileSync(path.join(workspace,'studio.json'),JSON.stringify({...data,currentId:draft.id,drafts:[draft,second],runs:[],workflowJobs:[],publishRecords:[]},null,2));
 write('prepared.json',{at:new Date().toISOString(),draftId:draft.id,secondDraftId:second.id,audioId:draft.voice.audioId,videoId:draft.video.assetId,originalAudioReused:true,modelSubmissions:0});
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
 const child=spawn(require('electron'),[__filename,'--remote-debugging-port=9350','--studio-data-dir='+workspace],{cwd:path.resolve(__dirname,'..'),env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 write('launch.json',{at:new Date().toISOString(),pid:child.pid,port:9350,workspace});const log=fs.createWriteStream(path.join(directory,'electron.log'),{flags:'a'});child.stdout.pipe(log);child.stderr.pipe(log);child.on('exit',(code,signal)=>{log.end();write('closed.json',{code,signal});if(code)process.exitCode=code;});console.log(JSON.stringify({pid:child.pid,port:9350}));
}
if(process.versions.electron&&!process.env.ELECTRON_RUN_AS_NODE){
 require('electron').app.setPath('userData',path.join(directory,'electron-profile'));
 const originalFetch=globalThis.fetch;
 // 本批只验证本地试听，禁止误触发任何模型请求。
 globalThis.fetch=async(input,options={})=>{const url=new URL(input);if(url.origin==='http://127.0.0.1:8188'&&(options.method||'GET').toUpperCase()==='POST')throw Error('本批试听验收禁止新增模型请求');return originalFetch(input,options);};
 require('../electron/main.cjs');
}else main().catch(error=>{console.error(error);process.exitCode=1;});
