// 每次换源使用独立音频元素，迟到的播放请求只能影响旧元素。
export function createDriverAudioTransport({createAudio,onState=()=>{}}){
 let entry=null,disposed=false;
 const snapshot=()=>({playing:!!entry&&!entry.audio.paused&&!entry.audio.ended,pending:!!entry?.pending,currentTime:Number(entry?.audio.currentTime)||0,duration:Number.isFinite(entry?.audio.duration)?entry.audio.duration:0,error:entry?.error||''});
 const publish=()=>{if(!disposed)onState(snapshot());};
 function release(){
  const previous=entry;entry=null;if(!previous)return;
  previous.wanted=false;previous.operation++;
  for(const [event,handler]of previous.handlers)previous.audio.removeEventListener(event,handler);
  previous.audio.pause();previous.audio.removeAttribute('src');previous.audio.load();previous.audio.remove();
 }
 function source(url){
  if(disposed)return;release();
  if(url){
   const audio=createAudio(),item={audio,wanted:false,pending:false,error:'',operation:0,handlers:[]};entry=item;
   const listen=(event,fn)=>{const handler=()=>{if(entry!==item||disposed)return;fn?.();publish();};item.handlers.push([event,handler]);audio.addEventListener(event,handler);};
   for(const event of ['loadedmetadata','durationchange','timeupdate','seeked'])listen(event);
   listen('play');listen('playing',()=>{item.pending=false;});listen('pause',()=>{item.pending=false;});
   listen('ended',()=>{item.wanted=false;item.pending=false;});
   listen('error',()=>{item.wanted=false;item.pending=false;item.error='驱动音频无法播放，请重新选取有效的音频文件';});
   audio.preload='metadata';audio.setAttribute('aria-label','驱动音频试听');audio.src=url;audio.load();
  }
  publish();
 }
 function pause(){if(!entry)return;entry.wanted=false;entry.operation++;entry.pending=false;entry.audio.pause();publish();}
 async function toggle(){
  const item=entry;if(!item||disposed)return;
  if(item.wanted||!item.audio.paused){pause();return;}
  const operation=++item.operation;item.wanted=true;item.pending=true;item.error='';
  if(item.audio.ended)item.audio.currentTime=0;publish();
  try{
   await item.audio.play();
   if(entry!==item||disposed||!item.wanted)item.audio.pause();
   if(entry===item&&operation===item.operation){item.pending=false;publish();}
  }catch(error){
   if(entry!==item||disposed||operation!==item.operation||!item.wanted)return;
   item.wanted=false;item.pending=false;item.error='驱动音频播放失败，请检查文件后重新试听';publish();
  }
 }
 function seek(seconds){if(!entry||!Number.isFinite(seconds)||!Number.isFinite(entry.audio.duration)||entry.audio.duration<=0)return;entry.audio.currentTime=Math.max(0,Math.min(entry.audio.duration,seconds));publish();}
 return {source,toggle,pause,seek,snapshot,get audio(){return entry?.audio;},dispose(){release();disposed=true;}};
}

export const waveformByteLimit=64*1024*1024;
export async function readWaveformBytes(response,{signal,maxBytes=waveformByteLimit}={}){
 if(!response.ok)throw Error('音频文件读取失败');
 if(Number(response.headers.get('content-length'))>maxBytes){await response.body?.cancel();throw Error('音频文件超过波形预览大小限制');}
 const reader=response.body?.getReader();if(!reader)throw Error('当前环境不支持波形流式读取');
 const chunks=[];let length=0;
 try{while(true){if(signal?.aborted)throw new DOMException('已取消','AbortError');const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>maxBytes)throw Error('音频文件超过波形预览大小限制');chunks.push(value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes.buffer;
}

export function waveformPeaks(samples,count=512){
 const peaks=new Float32Array(count);let maximum=0;
 for(let index=0;index<samples.length;index++){
  const value=Math.abs(samples[index]);if(!Number.isFinite(value))continue;
  const bin=Math.min(count-1,Math.floor(index*count/samples.length));if(value>peaks[bin])peaks[bin]=value;if(value>maximum)maximum=value;
 }
 if(maximum>0)for(let index=0;index<count;index++)peaks[index]/=maximum;
 return peaks;
}
