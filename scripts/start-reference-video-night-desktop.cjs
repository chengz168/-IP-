const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const directory=path.resolve(__dirname,'../evidence/validation/reference-video-night-20261115'),workspace=path.join(directory,'workspace');
const write=(file,data)=>fs.writeFileSync(path.join(directory,file),JSON.stringify(data,null,2));
async function main(){
 const launchFile=path.join(directory,'launch.json');
 if(fs.existsSync(launchFile))throw Error('已有本批桌面启动记录，先核实原窗口，不能同时打开同一Store');
 const collected=JSON.parse(fs.readFileSync(path.join(directory,'collection.json'),'utf8'));
 const data=JSON.parse(fs.readFileSync(path.join(workspace,'studio.json'),'utf8'));
 const previous=JSON.parse(fs.readFileSync(path.resolve('evidence/validation/reference-sample-20261115/workspace/studio.json'),'utf8'));
 if(data.runs.some(run=>['running','queued'].includes(run.status)))throw Error('验收工作区已有活动任务');
 if(!data.assets.some(asset=>asset.id===collected.asset.id))throw Error('真实回收资产不存在');
 const source=previous.drafts.find(draft=>draft.id===previous.currentId),draft=structuredClone(source);
 draft.id=crypto.randomUUID();draft.title='示例2夜间 · 参考视频实验';draft.step=3;draft.mode='manual';
 draft.createdAt=draft.updatedAt=new Date().toISOString();draft.video.assetId=collected.asset.id;
 draft.edit={...draft.edit,sourceId:collected.asset.id,resultId:''};draft.cover={...draft.cover,assetId:'',videoId:''};
 draft.publish={...draft.publish,recordId:'',videoId:'',coverId:''};draft.artifacts={};
 draft.experimentalProvenance={promptId:collected.promptId,importedAfterActualCollection:true,submittedThroughProductButton:false,originalAudioReused:true,qualityAccepted:false};
 // 只在独立验收工作区绑定真实回收资产；原工作区和原成片均不写入。
 const next={...data,avatars:previous.avatars,voices:previous.voices,currentId:draft.id,drafts:[draft],assets:[...previous.assets.filter(asset=>!data.assets.some(current=>current.id===asset.id)),...data.assets],runs:[],workflowJobs:[],publishRecords:[]};
 const temp=path.join(workspace,'studio-prepared.tmp');fs.writeFileSync(temp,JSON.stringify(next,null,2));fs.renameSync(temp,path.join(workspace,'studio.json'));
 write('desktop-prepared.json',{at:new Date().toISOString(),draftId:draft.id,assetId:collected.asset.id,modelSubmittedByThisScript:false,originalAudioReused:true,source:'独立实验脚本已完成生成与回收，之后绑定本工作区作真实播放器验证',qualityAccepted:false});
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
 const child=spawn(require('electron'),[__filename,'--remote-debugging-port=9349','--studio-data-dir='+workspace],{cwd:path.resolve(__dirname,'..'),env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 write('launch.json',{at:new Date().toISOString(),pid:child.pid,port:9349,workspace});
 const log=fs.createWriteStream(path.join(directory,'electron.log'),{flags:'a'});child.stdout.pipe(log);child.stderr.pipe(log);
 child.on('exit',(code,signal)=>{log.end();write('closed.json',{at:new Date().toISOString(),code,signal});if(code)process.exitCode=code;});
 console.log(JSON.stringify({pid:child.pid,port:9349}));
}
if(process.versions.electron&&!process.env.ELECTRON_RUN_AS_NODE){
 require('electron').app.setPath('userData',path.join(directory,'electron-profile'));
 const originalFetch=globalThis.fetch;
 // 本窗口只验收回收产物的播放，防止误点生成导致额外模型推理。
 globalThis.fetch=async(input,options={})=>{const url=new URL(input);if(url.origin==='http://127.0.0.1:8188'&&(options.method||'GET').toUpperCase()==='POST'&&url.pathname==='/prompt')throw Error('本实验窗口仅用于既有产物验收，禁止新增生成请求');return originalFetch(input,options);};
 require('../electron/main.cjs');
}else main().catch(error=>{console.error(error);process.exitCode=1;});
