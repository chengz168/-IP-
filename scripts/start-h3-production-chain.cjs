const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'evidence/validation/h3-production-chain'),workspace=path.join(directory,'workspace');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function main(){
 fs.mkdirSync(directory,{recursive:true});
 const resume=process.argv.includes('--resume');
 if(resume){
  // 恢复只读核验既有任务，不重新初始化数据，也不重新调用模型。
  const inputs=JSON.parse(fs.readFileSync(path.join(directory,'inputs.json'),'utf8'));
  const saved=JSON.parse(fs.readFileSync(path.join(workspace,'studio.json'),'utf8'));
  if(!saved.drafts.some(item=>item.id===inputs.draftId)||hash(inputs.sourceVideo)!==inputs.sourceVideoSha256)throw Error('既有下游任务或输入产物已变化，停止恢复');
 }else{
 const sourceFile=path.join(root,'evidence/validation/h3-long-generation/workspace/studio.json'),source=JSON.parse(fs.readFileSync(sourceFile,'utf8'));
 const parent=source.runs.find(item=>item.remote?.kind==='comfy-h3-sequence-v1'),draft=structuredClone(source.drafts.find(item=>item.id===parent.draftId));
 if(parent.status!=='succeeded'||!draft.video.assetId)throw Error('真实本地H3长片未完成，不能用替代素材验收下游');
 const asset=source.assets.find(item=>item.id===draft.video.assetId);if(hash(asset.path)!==asset.h3.outputSha256)throw Error('H3输入产物已变化');
 if(fs.existsSync(path.join(workspace,'studio.json')))throw Error('已存在下游验收记录，禁止重新初始化');
 const {Store}=require('../server/store.cjs'),store=new Store(workspace);draft.id=crypto.randomUUID();draft.title='本地H3长片制作链路';draft.step=4;
 store.data={...source,currentId:draft.id,drafts:[draft],runs:[],workflowJobs:[],settings:{...source.settings,outputDir:path.join(workspace,'outputs')}};store.save();
 const inputs={at:new Date().toISOString(),sourceFile,sourceFileSha256:hash(sourceFile),sourceRunId:parent.id,sourceVideo:asset.path,sourceVideoSha256:hash(asset.path),source:'本轮真实新生成H3长片，含待改进接缝',newModelInferenceInThisStage:false,newSpeechInThisStage:false,draftId:draft.id};
 fs.writeFileSync(path.join(directory,'inputs.json'),JSON.stringify(inputs,null,2));
 }
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
 const child=spawn(require('electron'),[__filename,'--remote-debugging-port=9339','--studio-data-dir='+workspace],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 fs.writeFileSync(path.join(directory,resume?'relaunch.json':'launch.json'),JSON.stringify({pid:child.pid,port:9339,workspace,resume},null,2));
 const log=fs.createWriteStream(path.join(directory,'electron.log'));child.stdout.pipe(log);child.stderr.pipe(log);
 console.log(JSON.stringify({pid:child.pid,workspace}));child.on('exit',code=>{log.end();if(code)process.exitCode=code;});
}
if(process.versions.electron&&!process.env.ELECTRON_RUN_AS_NODE){
 require('electron').app.setPath('userData',path.join(directory,'electron-profile'));
 require('../electron/main.cjs');
}else main().catch(error=>{console.error(error);process.exitCode=1;});
