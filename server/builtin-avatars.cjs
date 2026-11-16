const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// 每个模板只初始化一次，用户删除或改名后不在重启时重新创建或覆盖。
function ensureBuiltinAvatars(store,directory=path.join(__dirname,'avatar-templates')){
 let source;
 try{source=fs.readFileSync(path.join(directory,'catalog.json'),'utf8');}
 catch(error){
  // 形象包可选，仅清单不存在时跳过，其他读取错误仍交给调用方。
  if(error.code==='ENOENT')return {added:0,status:'not-installed',message:'未安装可选形象包'};
  throw error;
 }
 const catalog=JSON.parse(source);
 const imported=store.data.builtinAvatarImports||[];
 const pending=catalog.items.filter(item=>!imported.includes(item.id));
 if(!pending.length)return {added:0};
 for(const item of pending){
  for(const [name,sha]of [[item.video,item.videoSha256],[item.poster,item.posterSha256]]){
   if(path.basename(name)!==name||hash(path.join(directory,name))!==sha)throw Error('内置形象素材校验失败：'+item.name);
  }
 }
 const before={assets:[...store.data.assets],avatars:[...store.data.avatars],imports:store.data.builtinAvatarImports};
 const created=[];
 try{
  for(const item of pending){
   const metadata={origin:'builtin-avatar',templateId:item.id};
   const video=store.addAsset(path.join(directory,item.video),{...metadata,name:item.name+'.mp4',duration:item.duration,width:item.width,height:item.height},{persist:false});created.push(video);
   const poster=store.addAsset(path.join(directory,item.poster),{...metadata,name:item.name+'_cover.jpg'},{persist:false});created.push(poster);
   store.data.avatars.push({id:crypto.randomUUID(),name:item.name,assetId:video.id,posterId:poster.id,templateId:item.id,source:'reference-builtin',createdAt:new Date().toISOString()});
  }
  store.data.builtinAvatarImports=[...imported,...pending.map(item=>item.id)];
  store.save();return {added:pending.length};
 }catch(error){
  store.data.assets=before.assets;store.data.avatars=before.avatars;
  if(before.imports===undefined)delete store.data.builtinAvatarImports;else store.data.builtinAvatarImports=before.imports;
  for(const asset of created)fs.rmSync(asset.path,{force:true});
  throw error;
 }
}
module.exports={ensureBuiltinAvatars};
