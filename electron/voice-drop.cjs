const fs=require('node:fs');
const path=require('node:path');

const maxVoiceBytes=50*1024*1024;
const voiceExtension=/\.(mp3|wav|m4a|aac|flac|ogg|mp4|mov|mkv|webm|avi)$/i;

function createVoiceDropImporter({window,service}){
  return async(event,file)=>{
    const owner=window();
    // 仅接收工作台主页面的原生文件，不允许子页面或其他窗口导入本机路径。
    if(!owner||event.sender!==owner.webContents||event.senderFrame!==owner.webContents.mainFrame)throw new Error('窗口来源无效');
    if(typeof file!=='string'||!path.isAbsolute(file))throw new Error('无法读取拖入文件的本机路径，请重新从文件夹拖入');
    if(!voiceExtension.test(path.basename(file)))throw new Error('请选择支持的音频或视频文件');
    const stat=await fs.promises.stat(file);
    if(!stat.isFile())throw new Error('请拖入一个音频或视频文件，不能拖入文件夹');
    if(stat.size<=0||stat.size>maxVoiceBytes)throw new Error('文件须大于0且不超过50MB');
    const {path:assetPath,...asset}=await service.importPath(file);
    return asset;
  };
}

module.exports={createVoiceDropImporter,maxVoiceBytes};
