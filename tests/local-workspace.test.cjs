const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {initializeWorkspace,inspectWorkspace,localSettings}=require('../server/local-workspace.cjs');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'superip-daily-local-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const directory=path.join(root,'catalog');fs.mkdirSync(directory);
 // 这里只检验事务化文件导入，夹具不代表实际音视频或模型推理。
 const reference=path.join(root,'reference.wav');fs.writeFileSync(reference,'仅用于文件复制与哈希检查的夹具');
 for(const file of ['night.mp4','night.jpg'])fs.writeFileSync(path.join(directory,file),'内置素材文件夹具'+file);
 fs.writeFileSync(path.join(directory,'catalog.json'),JSON.stringify({items:[{id:'reference-avatar-2',name:'示例2-夜间',video:'night.mp4',poster:'night.jpg',videoSha256:hash(path.join(directory,'night.mp4')),posterSha256:hash(path.join(directory,'night.jpg')),duration:1,width:1080,height:1920}]}));
 const settings={theme:'default',fontSize:'comfortable',ffmpegPath:path.join(root,'ffmpeg.exe'),ffprobePath:path.join(root,'ffprobe.exe'),provider:{textProtocol:'ollama',baseUrl:'http://127.0.0.1:11434/v1',model:'fixture-local-model',ttsProtocol:'indextts-local',indexttsHome:path.join(root,'tts'),avatarProtocol:'musetalk-local',musetalkHome:path.join(root,'avatar'),asrProtocol:'local-whisper',asrPythonPath:path.join(root,'python.exe'),asrModelPath:path.join(root,'asr'),apiKey:'不可迁移的凭据',publishUrl:'https://not-for-import.invalid',avatarUrl:'https://not-for-import.invalid'}};
 return {root,workspace:path.join(root,'daily'),settings,referenceFile:reference,referenceSha256:hash(reference),referenceDuration:2,avatarDirectory:directory};
}
test('本地工作区落盘后素材均属于最终目录，初始草稿不含历史或演示结果',t=>{
 const input=fixture(t),result=initializeWorkspace(input);assert.equal(result.created,true);
 const {data,setup}=inspectWorkspace(input.workspace);
 assert.equal(data.voices.length,1);assert.equal(data.avatars.length,1);assert.equal(data.assets.length,3);assert.equal(data.runs.length,0);assert.equal(data.accounts.length,0);assert.equal(data.publishRecords.length,0);
 assert.equal(data.drafts.length,1);const draft=data.drafts[0];assert.equal(draft.finalText,'');assert.equal(draft.voice.profile,setup.voiceId);assert.equal(draft.voice.audioId,'');assert.equal(draft.video.avatarId,setup.avatarId);assert.equal(draft.video.assetId,'');assert.equal(draft.edit.resultId,'');assert.equal(draft.voice.emotion,'');assert.equal(draft.voice.speed,1);
 for(const asset of data.assets){assert.equal(path.dirname(asset.path),path.join(input.workspace,'assets'));assert(fs.existsSync(asset.path));assert(!asset.path.includes('.setup-'))}
 assert.equal(hash(data.assets.find(asset=>asset.id===setup.referenceId).path),input.referenceSha256);
 assert.equal(data.settings.outputDir,path.join(input.workspace,'outputs'));
 assert.equal(data.settings.provider.apiKey,undefined);assert.equal(data.settings.provider.publishUrl,'');assert.equal(data.settings.provider.avatarUrl,'');
});
test('重复初始化保留用户修改后的完整字节和资产，不重置配置或草稿',t=>{
 const input=fixture(t);initializeWorkspace(input);
 const file=path.join(input.workspace,'studio.json'),data=JSON.parse(fs.readFileSync(file,'utf8'));
 data.drafts[0].finalText='用户后来写入的文案';data.settings.provider.model='用户切换后的模型';data.voices[0].name='用户声音名';fs.writeFileSync(file,JSON.stringify(data));
 const before=hash(file),assets=data.assets.map(asset=>({file:asset.path,sha256:hash(asset.path)}));
 const again=initializeWorkspace({...input,referenceFile:path.join(input.root,'不存在的参考.wav')});
 assert.equal(again.created,false);assert.equal(hash(file),before);assert(assets.every(asset=>hash(asset.file)===asset.sha256));
});
test('损坏或未经初始化的目标拒绝写入，原文件保留',t=>{
 const input=fixture(t);fs.mkdirSync(input.workspace);const file=path.join(input.workspace,'studio.json');fs.writeFileSync(file,'用户损坏的数据原件');const before=hash(file);
 assert.throws(()=>initializeWorkspace(input),/尚未初始化/);assert.equal(hash(file),before);assert.deepEqual(fs.readdirSync(input.workspace),['studio.json']);
});
test('参考声哈希错误不会创建工作区或触碰原参考文件',t=>{
 const input=fixture(t),before=hash(input.referenceFile);assert.throws(()=>initializeWorkspace({...input,referenceSha256:'0'.repeat(64)}),/参考声校验不一致/);
 assert(!fs.existsSync(input.workspace));assert.equal(hash(input.referenceFile),before);assert(!fs.readdirSync(input.root).some(name=>name.startsWith('.daily.setup-')));
});
test('后续内置素材校验失败只回滚本批暂存目录，保留其他文件',t=>{
 const input=fixture(t),unrelated=path.join(input.root,'.daily.setup-user-owned');fs.mkdirSync(unrelated);fs.writeFileSync(path.join(unrelated,'keep.txt'),'用户文件');
 const originalHash=hash(input.referenceFile);fs.appendFileSync(path.join(input.avatarDirectory,'night.mp4'),'不匹配');
 assert.throws(()=>initializeWorkspace(input),/内置形象素材校验失败/);assert(!fs.existsSync(input.workspace));assert.equal(hash(input.referenceFile),originalHash);assert.equal(fs.readFileSync(path.join(unrelated,'keep.txt'),'utf8'),'用户文件');assert.deepEqual(fs.readdirSync(input.root).filter(name=>name.startsWith('.daily.setup-')),['.daily.setup-user-owned']);
});
test('本地初始化配置拒绝带凭据或外部文字服务，已建工作区损坏不自动修复',t=>{
 const input=fixture(t);
 for(const baseUrl of ['https://remote.invalid/v1','http://name:secret@127.0.0.1:11434/v1'])assert.throws(()=>localSettings({...input.settings,provider:{...input.settings.provider,baseUrl}},input.workspace),/本机地址/);
 initializeWorkspace(input);const file=path.join(input.workspace,'studio.json');fs.writeFileSync(file,'{损坏');const before=hash(file);assert.throws(()=>initializeWorkspace(input),/无法读取/);assert.equal(hash(file),before);
});
test('模板字体目录与实际绘制Python路径随本地配置交付',t=>{
 const input=fixture(t);input.settings.subtitleFontsDir=path.join(input.root,'已有模板字体');input.settings.subtitlePythonPath=path.join(input.root,'font-python.exe');
 initializeWorkspace(input);const {data}=inspectWorkspace(input.workspace);
 assert.equal(data.settings.subtitleFontsDir,input.settings.subtitleFontsDir);assert.equal(data.settings.subtitlePythonPath,input.settings.subtitlePythonPath);
});
