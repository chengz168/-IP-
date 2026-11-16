const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const capabilityKeys=['text','vision','tts','asr','image','video','avatar','clone','extract','brain'];
const scopes=['global',...capabilityKeys];
function checkedChanges(changes){
 if(!changes||typeof changes!=='object'||Array.isArray(changes))throw Error('服务密钥参数无效');
 const result={};
 for(const [scope,value]of Object.entries(changes)){
  if(!scopes.includes(scope)||typeof value!=='string'||value.length>8192||/[\r\n]/.test(value))throw Error('服务密钥格式或能力无效');
  result[scope]=value.trim();
 }
 return result;
}
async function effectiveKey(secrets,scope='global'){
 if(!scopes.includes(scope))throw Error('未知服务密钥能力');
 const own=scope!=='global'&&secrets.getScoped?await secrets.getScoped(scope):'';
 return own||await secrets.get();
}
async function keyState(secrets){
 const own=await Promise.all(capabilityKeys.map(async scope=>[scope,!!(secrets.getScoped&&await secrets.getScoped(scope))]));
 return {keyConfigured:!!await secrets.get(),capabilityKeyConfigured:Object.fromEntries(own)};
}
async function saveKeys(secrets,{key,capabilityKeys:updates}={}){
 if(updates!==undefined&&(!updates||typeof updates!=='object'||Array.isArray(updates)||Object.keys(updates).some(scope=>!capabilityKeys.includes(scope))))throw Error('独立密钥能力无效');
 const changes=checkedChanges({...updates,...(key!==undefined?{global:key}:{})});
 if(!Object.keys(changes).length)return;
 if(!secrets.update&&Object.keys(changes).some(scope=>scope!=='global'))throw Error('当前环境尚未提供独立密钥加密存储，原密钥未更改');
 const previous=Object.fromEntries(await Promise.all(Object.keys(changes).map(async scope=>[scope,scope==='global'?await secrets.get():await secrets.getScoped(scope)])));
 const write=values=>secrets.update?secrets.update(values):secrets.set(values.global);
 await write(changes);
 // 业务设置写盘失败时由调用方恢复原密钥，回退值只留在本次内存闭包。
 return ()=>write(previous);
}
function memorySecrets(){
 let values={};
 return {get:async()=>values.global||'',set:async value=>{values={...values,...checkedChanges({global:value})};},getScoped:async scope=>values[scope]||'',update:async changes=>{values={...values,...checkedChanges(changes)};}};
}
function encryptedSecrets(root,safeStorage){
 const file=path.join(root,'provider-keys.enc'),legacy=path.join(root,'provider-key.enc');
 function read(){
  if(!fs.existsSync(file)&&!fs.existsSync(legacy))return {};
  if(!safeStorage.isEncryptionAvailable())throw Error('系统加密存储暂不可用');
  if(fs.existsSync(file)){
   let data;try{data=JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));}catch{throw Error('服务密钥加密文件无法读取，原文件已保留');}
   if(data?.version!==1)throw Error('服务密钥加密文件版本无效，原文件已保留');
   return checkedChanges(data.values);
  }
  return {global:safeStorage.decryptString(fs.readFileSync(legacy))};
 }
 function update(changes){
  const checked=checkedChanges(changes);if(!Object.keys(checked).length)return;
  if(!safeStorage.isEncryptionAvailable())throw Error('系统加密存储暂不可用，密钥未保存');
  const values={...read(),...checked},encrypted=safeStorage.encryptString(JSON.stringify({version:1,values})),temporary=file+'.'+crypto.randomUUID()+'.tmp';
  // 加密后的完整字典一次替换，写入失败时保留旧密钥，绝不退回明文存储。
  try{fs.writeFileSync(temporary,encrypted,{flag:'wx',mode:0o600});fs.renameSync(temporary,file);}finally{fs.rmSync(temporary,{force:true});}
 }
 return {get:async()=>read().global||'',set:async value=>update({global:value}),getScoped:async scope=>{if(!capabilityKeys.includes(scope))throw Error('未知服务密钥能力');return read()[scope]||'';},update:async changes=>update(changes)};
}
module.exports={capabilityKeys,checkedChanges,effectiveKey,keyState,saveKeys,memorySecrets,encryptedSecrets};
