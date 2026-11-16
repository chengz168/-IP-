const fs=require('node:fs');
const path=require('node:path');

async function exportAsset({store,dialog,win},id,options={}){
  const asset=store.asset(id);
  if(!['image','video'].includes(asset.type))throw new Error('此处仅支持导出图片和视频');
  const video=asset.type==='video'&&options?.purpose==='video';
  const extension=path.extname(asset.path).slice(1);
  const result=await dialog.showSaveDialog(win,{
    title:video?'导出视频':asset.type==='image'?'导出封面图片':'导出封面视频',
    defaultPath:asset.name,
    filters:video?[{name:extension==='mp4'?'MP4 视频':'视频文件',extensions:[extension]},{name:'所有文件',extensions:['*']}]:[{name:asset.type==='image'?'封面图片':'封面视频',extensions:[extension]}]
  });
  if(result.canceled||!result.filePath)return {canceled:true};
  // 保存框打开期间素材可能被移走；同路径也必须重新确认源文件存在。
  store.asset(id);
  if(path.resolve(result.filePath).toLowerCase()!==path.resolve(asset.path).toLowerCase())await fs.promises.copyFile(asset.path,result.filePath);
  return {canceled:false,name:path.basename(result.filePath)};
}
module.exports={exportAsset};
