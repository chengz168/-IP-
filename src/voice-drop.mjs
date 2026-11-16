export const maxVoiceBytes=50*1024*1024;

export function validateVoiceFile(file){
  if(!file||!Number.isFinite(file.size)||file.size<=0||file.size>maxVoiceBytes)throw new Error('文件须大于0且不超过50MB');
  if(!/\.(mp3|wav|m4a|aac|flac|ogg|mp4|mov|mkv|webm|avi)$/i.test(file.name))throw new Error('请选择支持的音频或视频文件');
}

export async function importDroppedVoice(files,{studio,importFile,readBase64}){
  if(files.length!==1)throw new Error('请每次选择一个声音样本');
  const file=files[0];
  validateVoiceFile(file);
  // 桌面原生文件优先通过路径导入；浏览器及内存文件保留字节上传能力。
  const nativeImport=studio?.importDroppedVoice?.(file);
  if(nativeImport)return await nativeImport;
  return importFile({name:file.name,base64:await readBase64(file)});
}
