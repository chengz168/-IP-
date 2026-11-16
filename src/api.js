import {operationErrorMessage} from './operation-error.mjs';
import {importDroppedVoice as importVoiceDrop} from './voice-drop.mjs';
export const importDroppedVoice=files=>importVoiceDrop(files,{studio:window.studio,importFile:payload=>call('importFile',payload),readBase64:file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(new Error('无法读取文件'));reader.readAsDataURL(file);})});
export const call=async(action,payload={})=>{try{if(window.studio)return await window.studio.invoke(action,JSON.parse(JSON.stringify(payload)));const response=await fetch('/api/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await response.json();if(!response.ok)throw new Error(data.error||'请求失败');return data.result;}catch(error){throw Error(operationErrorMessage(error),{cause:error});}};
export const mediaUrl=id=>id?(window.studio?window.studio.media(id):'/media/'+encodeURIComponent(id)):'';
export async function pickFiles(kind='all',options={}){
  if(window.studio)return window.studio.pickFiles(kind,options);
  const accept={video:'video/*',music:'.mp3,.wav,.m4a,.aac,.flac',audio:'audio/*,video/*',image:'image/*',text:'.txt,.srt,.vtt,.json',visual:'video/*,image/*',all:'video/*,audio/*,image/*,.txt,.srt'}[kind];
  const files=await new Promise(resolve=>{const input=document.createElement('input');input.type='file';input.accept=accept;input.multiple=options.multiple!==false;input.onchange=()=>resolve([...input.files]);input.oncancel=()=>resolve([]);input.click();});
  if(options.maxSize&&files.some(file=>file.size>options.maxSize||!file.size))throw new Error('所选文件须大于0且不超过'+Math.round(options.maxSize/1024/1024)+'MB');
  const assets=[];for(const file of files){const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});assets.push(await call('importFile',{name:file.name,base64:data}));}return assets;
}
