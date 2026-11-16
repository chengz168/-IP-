const maximumBytes=50*1024*1024;
export function microphoneError(error){
 const messages={NotAllowedError:'麦克风访问被拒绝，请在系统及应用权限中允许麦克风后重试。',PermissionDeniedError:'麦克风访问被拒绝，请在系统及应用权限中允许麦克风后重试。',NotFoundError:'未找到可用麦克风，请连接设备后重试。',NotReadableError:'麦克风无法读取，请检查是否被其他程序占用后重试。',SecurityError:'当前环境不允许录音，请检查麦克风权限后重试。',NotSupportedError:'当前环境不支持录音，请使用桌面版或导入已有音频。'};
 return messages[error?.name]||String(error?.message||'录音失败，请检查麦克风后重试。');
}
export function recordingClock(seconds){const value=Math.max(0,Math.floor(seconds));return String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');}

// 每次申请独立持有媒体流，迟到的权限结果不能覆盖下一次录音。
export class AudioRecorderSession{
 constructor({getStream=()=>navigator.mediaDevices?.getUserMedia({audio:true})||Promise.reject(Object.assign(Error(),{name:'NotSupportedError'})),createRecorder=stream=>{if(typeof MediaRecorder==='undefined')throw Object.assign(Error(),{name:'NotSupportedError'});const mimeType=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type));return mimeType?new MediaRecorder(stream,{mimeType}):new MediaRecorder(stream);},save,onChange=()=>{},onSaved=()=>{},now=()=>performance.now(),interval=(fn)=>setInterval(fn,250),clear=timer=>clearInterval(timer),limitSeconds=120,maxBytes=maximumBytes}={}){
  Object.assign(this,{getStream,createRecorder,save,onChange,onSaved,now,interval,clear,limitSeconds,maxBytes});this.version=0;this.disposed=false;this.state={phase:'idle',seconds:0,error:'',reason:'',retryable:false};
 }
 change(patch){if(this.disposed)return;this.state={...this.state,...patch};this.onChange({...this.state});}
 closeStream(stream){for(const track of stream?.getTracks()||[])track.stop();}
 release(){this.clear(this.timer);this.timer=undefined;if(this.recorder){this.recorder.onstop=null;this.recorder.ondataavailable=null;this.recorder.onerror=null;if(this.recorder.state!=='inactive')try{this.recorder.stop();}catch{}this.recorder=null;}for(const [track,ended]of this.listeners||[])track.removeEventListener('ended',ended);this.listeners=[];this.closeStream(this.stream);this.stream=null;}
 cancel(){this.version++;this.release();this.blob=null;this.context=null;this.change({phase:'idle',seconds:0,error:'',reason:'',retryable:false});}
 dispose(){this.cancel();this.disposed=true;}
 async start(context){
  if(this.disposed||['requesting','recording','stopping','saving'].includes(this.state.phase))return false;
  this.cancel();const mine=this.version;this.context=context;this.change({phase:'requesting'});
  try{
   const stream=await this.getStream();if(this.disposed||mine!==this.version){this.closeStream(stream);return false;}this.stream=stream;
   if(!stream?.getAudioTracks().some(track=>track.readyState==='live'))throw Object.assign(Error(),{name:'NotFoundError'});
   const recorder=this.createRecorder(stream),chunks=[];let bytes=0;this.recorder=recorder;
   recorder.ondataavailable=event=>{if(mine!==this.version||!event.data?.size)return;bytes+=event.data.size;if(bytes>this.maxBytes){this.fail('录音超过50MB，请缩短录制时间后重试。');return;}chunks.push(event.data);};
   recorder.onerror=event=>{if(mine===this.version)this.fail(microphoneError(event.error||event));};
   recorder.onstop=()=>{if(mine!==this.version||this.disposed)return;const type=recorder.mimeType||chunks[0]?.type||'';this.release();this.blob=new Blob(chunks,{type});if(!this.blob.size){this.fail('没有录到有效音频，请检查麦克风后重新录制。');return;}void this.persist(mine);};
   this.listeners=stream.getAudioTracks().map(track=>{const ended=()=>{if(mine===this.version&&this.state.phase==='recording')this.stop('device-ended');};track.addEventListener('ended',ended);return [track,ended];});
   recorder.start(250);this.startedAt=this.now();this.change({phase:'recording',seconds:0});this.timer=this.interval(()=>{const seconds=Math.max(0,(this.now()-this.startedAt)/1000);this.change({seconds:Math.min(this.limitSeconds,seconds)});if(seconds>=this.limitSeconds)this.stop('limit');});return true;
  }catch(error){if(mine===this.version&&!this.disposed)this.fail(microphoneError(error));return false;}
 }
 stop(reason='user'){
  if(this.state.phase!=='recording')return false;
  this.clear(this.timer);this.timer=undefined;this.change({phase:'stopping',reason});
  try{this.recorder.stop();this.closeStream(this.stream);return true;}catch(error){this.fail(microphoneError(error));return false;}
 }
 fail(error,retryable=false){this.release();if(!retryable)this.blob=null;this.change({phase:'error',error:String(error),retryable:retryable&&!!this.blob});}
 async persist(mine=this.version){
  if(!this.blob||this.disposed||mine!==this.version||this.state.phase==='saving')return false;
  this.change({phase:'saving',error:'',retryable:false});
  try{const asset=await this.save(this.blob,this.context);if(mine!==this.version||this.disposed)return false;this.blob=null;this.change({phase:'idle',retryable:false});this.onSaved(asset,this.context,this.state.reason);return true;}
  catch(error){if(mine===this.version&&!this.disposed)this.fail('录音保存失败：'+microphoneError(error),true);return false;}
 }
}
