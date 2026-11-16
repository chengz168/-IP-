// 本机交付时只读既有验证结果，日常启动不依赖这些证据文件。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {initializeWorkspace}=require('../server/local-workspace.cjs');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const {Media}=require('../server/media.cjs'),{LocalAsr}=require('../server/local-asr.cjs');
const root=path.resolve(__dirname,'..'),evidence=path.join(root,'evidence/validation/daily-local-workspace-20261116');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const write=(name,value)=>fs.writeFileSync(path.join(evidence,name),JSON.stringify(value,null,2),{flag:'wx'});
async function main(){
 fs.mkdirSync(evidence,{recursive:true});assert(!fs.existsSync(path.join(evidence,'prepared.json')),'准备凭据已存在，检查现有工作区，不重新导入');
 const source=read('evidence/validation/musetalk-integration-20261115/workspace/studio.json'),C=read('evidence/validation/voice-match-review-20261115/generated-normal.json');
 const config=C.run.parameters.input,reference=source.assets.find(asset=>asset.id===config.referenceId);
 assert.equal(digest(reference.path),config.referenceSha256);
 const protectedFiles=read('evidence/validation/voice-C-long-script-20261116/baseline.json').protectedFiles;
 assert(protectedFiles.every(file=>digest(file.file)===file.sha256));
 const settings=structuredClone(source.settings),workspace=path.join(root,'workspaces/local-studio');
 const index=require('../server/local-indextts.cjs').inspectEnvironment(settings.provider);assert(index.readyForProbe,'IndexTTS文件检查未通过');
 const musetalk=require('../server/local-musetalk.cjs').runtimeOptions(settings.provider);
 const design=require('../server/voice-design.cjs').runtimeOptions(settings.provider);
 const store={data:source,asset:id=>source.assets.find(asset=>asset.id===id)},media=new Media(store);
 const asr=new LocalAsr(store,media).options(),binaries=media.binaries();assert(fs.existsSync(binaries.ffmpeg)&&fs.existsSync(binaries.ffprobe));
 const metadata=await media.probe(reference.path),duration=Number(metadata.format.duration);assert(duration>=1&&duration<=60);
 const modelResponse=await fetch(new URL('/api/tags',settings.provider.baseUrl),{signal:AbortSignal.timeout(5000)});assert(modelResponse.ok);
 const models=await modelResponse.json();assert(models.models.some(model=>model.name===settings.provider.model));
 const extraction={extractProtocol:'local',extractPythonPath:'C:/Python314/python.exe',extractPackagePath:'D:/AI-Runtimes/super-ip/link-extractor/2026.10.26/package'};
 if(fs.existsSync(extraction.extractPythonPath)&&fs.existsSync(extraction.extractPackagePath))Object.assign(settings.provider,extraction);
 write('baseline.json',{at:new Date().toISOString(),protectedFiles,originalDefaultWorkspace:path.join(root,'data/studio.json'),originalDefaultSha256:digest(path.join(root,'data/studio.json')),workspaceExisted:fs.existsSync(workspace)});
 const initialized=initializeWorkspace({workspace,settings,referenceFile:reference.path,referenceSha256:config.referenceSha256,referenceDuration:duration});
 const data=JSON.parse(fs.readFileSync(path.join(workspace,'studio.json'),'utf8'));
 assert(data.assets.every(asset=>asset.path.startsWith(workspace+path.sep)&&fs.existsSync(asset.path)));
 write('prepared.json',{at:new Date().toISOString(),...initialized,workspace,draftId:data.currentId,settings:data.settings,voices:data.voices,avatars:data.avatars,managedAssetCount:data.assets.length,referenceSha256:config.referenceSha256,referenceDuration:duration,runtimeFiles:{indextts:index.readyForProbe,musetalk,voiceDesign:design,asr,binaries},ollamaModelPresent:true,newModelDownloads:0,existingUserDataReplaced:false});
 console.log(JSON.stringify({created:initialized.created,workspace,voiceCount:data.voices.length,avatarCount:data.avatars.length,assetCount:data.assets.length,defaultWorkspaceUnchanged:digest(path.join(root,'data/studio.json'))===read('evidence/validation/daily-local-workspace-20261116/baseline.json').originalDefaultSha256}));
}
main().catch(error=>{fs.appendFileSync(path.join(evidence,'errors.jsonl'),JSON.stringify({at:new Date().toISOString(),mode:'prepare',error:error.stack})+'\n');console.error(error);process.exitCode=1});
