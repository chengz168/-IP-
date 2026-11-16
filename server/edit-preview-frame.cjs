const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {runProcess}=require('./media.cjs');

async function previewEditFrame(media,assetId){
  const source=media.store.asset(assetId);
  if(source.type!=='video')throw Error('编辑预览需要视频素材');
  const before=await fs.stat(source.path);
  if(!before.isFile()||!before.size)throw Error('预览视频为空或不是普通文件');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'superip-edit-preview-'));
  try{
    const target=path.join(directory,'first-frame.png');
    await runProcess(media.binaries().ffmpeg,['-y','-v','error','-i',source.path,'-frames:v','1','-update','1',target],{signal:AbortSignal.timeout(15000)});
    const image=await fs.readFile(target),after=await fs.stat(source.path);
    if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('视频文件已变化，请重新读取预览');
    if(image.length<24||image.length>50000000||image.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('未取得有效的视频首帧');
    const width=image.readUInt32BE(16),height=image.readUInt32BE(20);
    if(!width||!height||width>8192||height>8192)throw Error('预览画面尺寸不受支持');
    return {assetId,width,height,dataUrl:'data:image/png;base64,'+image.toString('base64')};
  }finally{await fs.rm(directory,{recursive:true,force:true});}
}
module.exports={previewEditFrame};
