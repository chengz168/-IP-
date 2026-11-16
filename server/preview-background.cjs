const fs=require('node:fs'),path=require('node:path');

function readPreviewBackground(referenceHeight,directory=__dirname){
 if(![1080,1920].includes(referenceHeight))throw Error('字幕预览方向无效');
 const name=referenceHeight===1920?'subtitle-portrait.png':'subtitle-landscape.png';
 try{return fs.readFileSync(path.join(directory,'assets',name));}
 catch(error){
  // 仅旧图不存在时使用自制图，读取和图片解码错误不得触发静默替换。
  if(error.code!=='ENOENT')throw error;
 }
 try{return fs.readFileSync(path.join(directory,'preview-assets',name));}
 catch(error){
  if(error.code==='ENOENT')throw new Error('字幕预览背景缺失，请恢复自制预览图：'+name,{cause:error});
  throw error;
 }
}
module.exports={readPreviewBackground};
