const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Store}=require('./store.cjs');
const {ensureBuiltinAvatars}=require('./builtin-avatars.cjs');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const providerFields=['textProtocol','baseUrl','model','textMaxTokens','textContextTokens','ttsProtocol','indexttsHome','voiceDesignHome','avatarProtocol','musetalkHome','asrProtocol','asrPythonPath','asrModelPath','asrLanguage','extractProtocol','extractPythonPath','extractPackagePath'];

// 只导入本机模型配置，账号、密钥及其他远程设置不进入新工作区。
function localSettings(settings,workspace){
 const provider=Object.fromEntries(providerFields.filter(key=>typeof settings.provider?.[key]==='string').map(key=>[key,settings.provider[key]]));
 if(provider.textProtocol!=='ollama'||provider.ttsProtocol!=='indextts-local'||provider.avatarProtocol!=='musetalk-local'||provider.asrProtocol!=='local-whisper')throw Error('初始化需要已验证的本地文案、配音、口型和识别配置');
 const endpoint=new URL(provider.baseUrl);
 if(!['http:','https:'].includes(endpoint.protocol)||!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)||endpoint.username||endpoint.password)throw Error('本地文字模型地址必须是无凭据的本机地址');
 for(const key of ['indexttsHome','musetalkHome','asrPythonPath','asrModelPath'])if(!provider[key]||!path.isAbsolute(provider[key]))throw Error('缺少本地模型绝对路径：'+key);
 for(const key of ['ffmpegPath','ffprobePath'])if(!settings[key]||!path.isAbsolute(settings[key]))throw Error('缺少媒体工具绝对路径：'+key);
 const fontSettings=Object.fromEntries(['subtitleFontsDir','subtitlePythonPath'].filter(key=>typeof settings[key]==='string'&&settings[key]).map(key=>[key,settings[key]]));
 for(const [key,value] of Object.entries(fontSettings))if(!path.isAbsolute(value))throw Error('模板字体或绘制环境需使用绝对路径：'+key);
 return {theme:settings.theme||'default',fontSize:settings.fontSize||'comfortable',view:'new',mode:'own',outputDir:path.join(workspace,'outputs'),ffmpegPath:settings.ffmpegPath,ffprobePath:settings.ffprobePath,...fontSettings,provider};
}

function inspectWorkspace(workspace){
 if(!path.isAbsolute(workspace))throw Error('工作区必须使用绝对路径');
 const file=path.join(workspace,'studio.json'),receipt=path.join(workspace,'local-setup.json');
 if(!fs.existsSync(file)||!fs.existsSync(receipt))throw Error('本地工作区尚未初始化，原目录未改写');
 let data,setup;
 try{data=JSON.parse(fs.readFileSync(file,'utf8'));setup=JSON.parse(fs.readFileSync(receipt,'utf8'))}catch{throw Error('本地工作区数据无法读取，原文件已保留')}
 if(!Array.isArray(data.drafts)||!Array.isArray(data.assets)||!Array.isArray(data.voices)||setup.kind!=='daily-local-workspace-v1')throw Error('本地工作区结构无效，原文件已保留');
 return {workspace,data,setup};
}

// 在同盘暂存目录完成导入，再原子更名；已有用户数据绝不重新播种。
function initializeWorkspace({workspace,settings,referenceFile,referenceSha256,referenceDuration,voiceName='C参考女声',avatarDirectory}){
 workspace=path.resolve(workspace);
 if(fs.existsSync(workspace)){inspectWorkspace(workspace);return {created:false,workspace}}
 if(!referenceSha256||hash(referenceFile)!==referenceSha256)throw Error('C参考声校验不一致，未初始化工作区');
 if(!voiceName.trim()||voiceName.length>10)throw Error('声音名称需为1至10字');
 const configured=localSettings(settings,workspace),parent=path.dirname(workspace);
 fs.mkdirSync(parent,{recursive:true});
 const prefix='.'+path.basename(workspace)+'.setup-',staging=fs.mkdtempSync(path.join(parent,prefix));
 try{
  const store=new Store(staging);
  store.data.settings={...store.data.settings,...configured,provider:{...store.data.settings.provider,...configured.provider}};
  const sample=store.addAsset(referenceFile,{name:voiceName+'.wav',origin:'authorized-local-reference',duration:referenceDuration},{persist:false});
  if(hash(sample.path)!==referenceSha256)throw Error('复制后参考声校验失败');
  const voice={id:crypto.randomUUID(),name:voiceName,sampleId:sample.id,status:'sample-only',createdAt:new Date().toISOString()};
  store.data.voices.push(voice);
  ensureBuiltinAvatars(store,avatarDirectory);
  const avatar=store.data.avatars.find(item=>item.templateId==='reference-avatar-2');
  if(!avatar)throw Error('内置示例二不存在，未提交工作区');
  const draft=store.draft();
  draft.title='本地创作';Object.assign(draft.voice,{profile:voice.id,speed:1,emotion:'',strength:.7,prosodyReferenceId:''});
  draft.video.avatarId=avatar.id;Object.assign(draft.edit,{subtitleMode:'template',subtitleTemplate:'simple_blue_white',subtitleMaxChars:6});
  for(const asset of store.data.assets){
   const relative=path.relative(staging,asset.path);
   if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('导入素材超出本次暂存目录');
   asset.path=path.join(workspace,relative);
  }
  store.save();
  const setup={kind:'daily-local-workspace-v1',createdAt:new Date().toISOString(),workspace,voiceId:voice.id,referenceId:sample.id,referenceSha256,avatarId:avatar.id,avatarTemplateId:avatar.templateId,assets:store.data.assets.length,avatars:store.data.avatars.length,sourceRuntime:true,existingUserDataReplaced:false};
  fs.writeFileSync(path.join(staging,'local-setup.json'),JSON.stringify(setup,null,2),{flag:'wx'});
  if(fs.existsSync(workspace))throw Error('目标目录在初始化期间被创建，原目录未覆盖');
  fs.renameSync(staging,workspace);
  return {created:true,workspace,setup};
 }catch(error){
  const resolved=path.resolve(staging);
  if(path.dirname(resolved)===parent&&path.basename(resolved).startsWith(prefix))fs.rmSync(resolved,{recursive:true,force:true});
  throw error;
 }
}
module.exports={localSettings,inspectWorkspace,initializeWorkspace};
