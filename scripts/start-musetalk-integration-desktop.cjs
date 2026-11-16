const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'evidence/validation/musetalk-integration-20261115'),workspace=path.join(directory,'workspace');
const write=(name,data)=>fs.writeFileSync(path.join(directory,name),JSON.stringify(data,null,2));
async function seed(){
 if(fs.existsSync(path.join(workspace,'studio.json')))throw Error('已有本批工作区，不覆盖已有执行数据');
 const baseFile=path.join(root,'evidence/validation/video-driver-audio/workspace/studio.json'),base=JSON.parse(fs.readFileSync(baseFile,'utf8'));
 const inputs=JSON.parse(fs.readFileSync(path.join(root,'evidence/validation/indextts-generation/inputs.json'),'utf8'));
 if(digest(inputs.reference.path)!==inputs.reference.sha256)throw Error('原授权合成声音参考已变化');
 const source='F:/Software/轻语IP智能体/aigc-human/resources/assets/videos/示例2-夜间.mp4';
 const protectedFiles=[baseFile,path.join(root,'data/studio.json'),path.join(root,'evidence/validation/reference-sample-20261115/workspace/studio.json'),inputs.reference.path,source,'F:/Software/轻语IP智能体/aigc-human/outputs/videos/cloud_1794663289391.mp4'].map(file=>({file,sha256:digest(file)}));
 const {Store}=require('../server/store.cjs'),{Media}=require('../server/media.cjs'),store=new Store(workspace),media=new Media(store);
 store.data.settings={...base.settings,outputDir:path.join(workspace,'outputs'),provider:{...base.settings.provider,avatarProtocol:'musetalk-local',musetalkHome:'D:/AI-Runtimes/super-ip/musetalk-1.5'}};
 const original=await media.probe(source),shape=store.addAsset(source,{name:'示例2-夜间.mp4',origin:'reference-builtin-avatar',duration:Number(original.format.duration)});
 const voiceSample=store.addAsset(inputs.reference.path,{name:'自主合成声音参考.wav',origin:'self-generated-h3-voice-reference',duration:inputs.reference.duration});
 store.data.voices=[{...inputs.voice,sampleId:voiceSample.id}];store.data.avatars=[{id:'musetalk-night-shape',name:'示例2-夜间',assetId:shape.id}];
 store.data.prompts=[{id:'musetalk-night-copy',name:'夜间闲聊验证模板',type:'copy',active:true,content:'你是中文口播编辑。根据用户给出的生活片段写成自然的第一人称口播，不虚构人物、数据、功效或经历。不输出标题、括号动作、分析和提示，只输出约120字可直接朗读的完整正文。保持原文事实和夜间聊天的轻松语气。'}];
 const draft=store.draft();Object.assign(draft,{title:'示例二 · 新文案新配音本地口型',mode:'manual',step:1,wordLimit:'120',template:'musetalk-night-copy',sourceText:'晚上出门走一走，发现路边的灯已经亮了。我想和你聊聊，忙了一天以后，可以怎样留一点时间给自己。不一定要安排很特别的活动，沿着熟悉的小路走一段，看看夜景，和朋友说几句话，或者只是安静待一会儿。今天的视频就从眼前的灯光说起，分享一个普通夜晚里轻松的小片段。'});
 Object.assign(draft.voice,{profile:inputs.voice.id,speed:1,emotion:'',strength:.7,audioId:''});Object.assign(draft.video,{mode:'single',avatarId:'musetalk-night-shape',audioId:'',assetId:''});
 store.save();write('prepared.json',{at:new Date().toISOString(),workspace,draftId:draft.id,sourceVideo:source,sourceVideoSha256:digest(source),reference:{...inputs.reference,id:voiceSample.id,path:voiceSample.path},voice:store.data.voices[0],protectedFiles,voiceProvenance:inputs.provenance,newModelSubmissions:0,qualityAccepted:false});
 console.log(JSON.stringify({seeded:true,draftId:draft.id,sourceDuration:Number(original.format.duration)}));
}
async function main(){
 if(process.argv.includes('--seed-only'))return seed();
 if(!fs.existsSync(path.join(directory,'prepared.json')))throw Error('请先准备隔离工作区');
 if(fs.existsSync(path.join(directory,'launch.json')))throw Error('已有窗口启动记录，请实时核实后单独恢复，不自动启动第二个窗口');
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDIO_DEV_URL;
 const child=spawn(require('electron'),[__filename,'--remote-debugging-port=9351','--studio-data-dir='+workspace],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 write('launch.json',{at:new Date().toISOString(),pid:child.pid,port:9351,workspace});const log=fs.createWriteStream(path.join(directory,'electron.log'),{flags:'a'});child.stdout.pipe(log);child.stderr.pipe(log);child.on('exit',(code,signal)=>{write('closed.json',{at:new Date().toISOString(),code,signal});log.end();if(code)process.exitCode=code;});console.log(JSON.stringify({pid:child.pid,port:9351}));
}
if(process.versions.electron&&!process.env.ELECTRON_RUN_AS_NODE){require('electron').app.setPath('userData',path.join(directory,'electron-profile'));require('../electron/main.cjs');}
else main().catch(error=>{console.error(error);process.exitCode=1;});
