// 使用独立工作区和既有授权参考声，验证用户已选C音色的新文案配音。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {Store}=require('../server/store.cjs'),{digest}=require('../integrations/musetalk-local/input.cjs');
const root=path.resolve(__dirname,'../evidence/validation/voice-C-long-script-20261116'),workspace=path.join(root,'workspace');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const write=(name,data)=>fs.writeFileSync(path.join(root,name),JSON.stringify(data,null,2),{flag:'wx'});
const text='刚下班的时候，我本来想直接回家，后来还是决定出来走走。你看，路边的灯已经亮了，风吹过来也不冷，正好可以慢慢逛一会儿。\n\n今天其实没发生什么特别的事，就是事情一件接一件，等忙完才发现，连水都没顾上喝几口。现在站在这儿，反而觉得，能有这么一小段不用赶时间的空当，还挺舒服的。\n\n你平时下班以后，会想马上回家，还是也愿意绕一点路？我以前总觉得，出来散步得先找个地方，后来发现，不用计划那么多，沿着熟悉的街道走几分钟就够了。\n\n好了，前面那家店还开着，我去买杯热的。今天就先聊到这儿，你也早点休息。';
function seed(){
 assert(!fs.existsSync(workspace),'已有独立工作区，不重新播种');
 const sourceFile=path.resolve(root,'../musetalk-integration-20261115/workspace/studio.json');
 const source=read(sourceFile),candidate=read(path.resolve(root,'../voice-match-review-20261115/generated-normal.json'));
 const preference=read(path.resolve(root,'../voice-C-emotion-20261116/human-preference-C-over-C2-20261116.json'));
 assert.equal(candidate.run.id,'828c8a82-25e3-4daf-93f1-6d375b356f1e');
 assert.equal(candidate.run.status,'succeeded');
 const input=candidate.run.parameters.input;
 assert.equal(input.speed,1);assert.equal(input.seed,42);assert.equal(input.emotion,'');
 const voice=source.voices.find(item=>item.id===input.profileId),reference=source.assets.find(item=>item.id===voice?.sampleId);
 assert.equal(reference?.type,'audio');assert.equal(digest(reference.path),input.referenceSha256);
 assert.equal(digest(candidate.file),candidate.sha256||candidate.run.output.speech.outputSha256);
 assert(fs.existsSync(source.settings.provider.indexttsHome));
 const oldProtection=read(path.resolve(root,'../caption-phrases-C-20261116/baseline.json')).protectedFiles;
 const protectedFiles=[...oldProtection,{file:candidate.file,sha256:digest(candidate.file)},{file:reference.path,sha256:digest(reference.path)}];
 assert(protectedFiles.every(item=>digest(item.file)===item.sha256));
 fs.mkdirSync(root,{recursive:true});
 write('baseline.json',{at:new Date().toISOString(),protectedFiles,preference,sourceFile,sourceInput:input});
 const store=new Store(workspace);
 store.data.settings={...store.data.settings,...structuredClone(source.settings),view:'new',mode:'own',outputDir:path.join(workspace,'outputs')};
 const newReference=store.addAsset(reference.path,{name:'C音色-既有授权参考.wav',origin:'C-long-authorized-reference',duration:reference.duration});
 assert.equal(digest(newReference.path),input.referenceSha256);
 store.data.voices=[{...structuredClone(voice),name:'C音色（已选参考）',sampleId:newReference.id}];
 const draft=store.draft();
 Object.assign(draft,{title:'C音色-新文案连续口播',mode:'manual',step:2,language:'中文',sourceText:'',rewrite:'',finalText:'',confirmed:false});
 Object.assign(draft.voice,{profile:voice.id,speed:1,emotion:'',strength:.7,audioId:'',prosodyReferenceId:''});
 store.save();
 fs.writeFileSync(path.join(root,'口播文案.txt'),text,{flag:'wx'});
 write('prepared.json',{at:new Date().toISOString(),workspace,draftId:draft.id,text,textOrigin:'本次验证创作，不是原厂台词或提示词',voiceId:voice.id,referenceId:newReference.id,referenceSha256:digest(newReference.path),speed:1,seed:42,emotion:'',strength:.7,prosodyReferenceId:'',originalRunIds:[],originalAssetIds:[newReference.id],humanQualityAccepted:false});
 console.log(JSON.stringify({draftId:draft.id,textLength:text.length,protectedFiles:protectedFiles.length}));
}
async function launch(){
 assert(fs.existsSync(path.join(root,'prepared.json')),'先准备隔离数据');
 assert(!fs.existsSync(path.join(root,'launch.json')),'已有进程凭据，不重复启动');
 let occupied=false;try{occupied=(await fetch('http://127.0.0.1:9373/json/version')).ok}catch{}assert(!occupied,'端口9373被占用');
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
 const log=fs.openSync(path.join(root,'electron.log'),'a');
 const child=spawn(require('electron'),[__filename,'--remote-debugging-port=9373','--studio-data-dir='+workspace],{cwd:path.resolve(__dirname,'..'),env,windowsHide:true,detached:true,stdio:['ignore',log,log]});
 child.unref();fs.closeSync(log);
 write('launch.json',{at:new Date().toISOString(),pid:child.pid,port:9373,workspace,packagedExeStarted:false});
 console.log(JSON.stringify({pid:child.pid,port:9373}));
}
if(process.versions.electron&&!process.env.ELECTRON_RUN_AS_NODE){require('electron').app.setPath('userData',path.join(root,'electron-profile'));require('../electron/main.cjs');}
else Promise.resolve().then(()=>process.argv.includes('--seed-only')?seed():launch()).catch(error=>{console.error(error);process.exitCode=1});
