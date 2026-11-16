const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'evidence/validation/indextts-generation'),workspace=path.join(directory,'workspace');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write=(name,value)=>fs.writeFileSync(path.join(directory,name),JSON.stringify(value,null,2));

async function main(){
 fs.mkdirSync(directory,{recursive:true});
 if(process.argv.includes('--seed-only')){
  if(fs.existsSync(path.join(workspace,'studio.json')))throw Error('已有声音验收数据，不允许重置');
  const protectedFiles=['data/studio.json','evidence/validation/local-generation/workspace/studio.json','evidence/validation/pip-desktop-workspace/studio.json','evidence/validation/h3-multi-generation/workspace/studio.json'].map(file=>path.join(root,file)).filter(file=>fs.existsSync(file)).map(file=>({file,sha256:hash(file)}));
  const inputs=JSON.parse(fs.readFileSync(path.join(root,'evidence/validation/h3-multi-generation/inputs.json'),'utf8'));
  if(hash(inputs.sourceVideo)!==inputs.sourceVideoSha256)throw Error('自主生成人物输入已经变化');
  const source=JSON.parse(fs.readFileSync(inputs.sourceFile,'utf8')),{Store}=require('../server/store.cjs'),{Media,runProcess}=require('../server/media.cjs');
  const store=new Store(workspace),media=new Media(store);
  store.data.settings={...store.data.settings,...source.settings,outputDir:path.join(workspace,'outputs'),provider:{...source.settings.provider,ttsProtocol:'indextts-local',indexttsHome:'D:/AI-Runtimes/super-ip/indextts-2.5'}};
  const audio=path.join(store.outputDir(),'reference.wav');
  await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',inputs.sourceVideo,'-vn','-ac','1','-ar','24000','-c:a','pcm_s16le',audio]);
  const probe=await media.probe(audio),duration=Number(probe.format.duration),asset=store.addAsset(audio,{name:'自主H3合成声音参考.wav',origin:'self-generated-h3-voice-reference',duration,sourceVideoSha256:inputs.sourceVideoSha256});
  const voice={id:crypto.randomUUID(),name:'合成声音参考',sampleId:asset.id,status:'sample-only',createdAt:new Date().toISOString()};store.data.voices=[voice];
  const draft=store.draft();draft.name='本地声音真实生成验收';draft.step=2;draft.mode='manual';draft.finalText='今天我们用一个简单的方法，让桌面的光线更舒服。把台灯移到左边，调整灯头，再打开开关。';draft.language='中文';draft.confirmed=true;
  draft.voice={...draft.voice,profile:voice.id,speed:1,emotion:'',strength:.7,audioId:''};store.save();
  write('inputs.json',{at:new Date().toISOString(),workspace,draftId:draft.id,text:draft.finalText,sourceVideo:inputs.sourceVideo,sourceVideoSha256:inputs.sourceVideoSha256,reference:{id:asset.id,path:asset.path,duration,sha256:hash(asset.path)},voice,protectedFiles,
   provenance:'参考音频提取自此前本机H3自主生成的虚构人物音轨，仅作模型输入；没有将旧音轨冒充本轮新生成声音',inferencePerformed:false,qualityAccepted:false});
  console.log(JSON.stringify({seeded:true,draftId:draft.id,referenceDuration:duration}));return;
 }
 const inputs=JSON.parse(fs.readFileSync(path.join(directory,'inputs.json'),'utf8'));
 if(hash(inputs.reference.path)!==inputs.reference.sha256)throw Error('声音验收参考文件已经变化');
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
 const child=spawn(require('electron'),[__filename,'--remote-debugging-port=9342','--studio-data-dir='+workspace],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 write('launch.json',{at:new Date().toISOString(),pid:child.pid,port:9342,workspace,draftId:inputs.draftId,protectedFiles:inputs.protectedFiles});
 const log=fs.createWriteStream(path.join(directory,'electron.log'),{flags:'a'});child.stdout.pipe(log);child.stderr.pipe(log);console.log(JSON.stringify({pid:child.pid,port:9342,workspace}));
 child.on('exit',(code,signal)=>{write('closed.json',{at:new Date().toISOString(),code,signal,protectedFiles:inputs.protectedFiles.map(item=>({...item,unchanged:hash(item.file)===item.sha256}))});log.end();if(code)process.exitCode=code;});
}
if(process.versions.electron&&!process.env.ELECTRON_RUN_AS_NODE){require('electron').app.setPath('userData',path.join(directory,'electron-profile'));require('../electron/main.cjs');}
else main().catch(error=>{console.error(error);process.exitCode=1;});
