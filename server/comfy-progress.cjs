const labels={UNETLoader:'加载视频模型',CLIPLoader:'加载文本模型',VAELoader:'加载编解码模型',LoraLoaderModelOnly:'加载采样模型',MiniMaxH3ImageToVideo:'处理提示词与首帧',MiniMaxH3AddGuide:'处理驱动音频',Wan22ImageToVideoLatent:'准备首帧与视频时长',KSampler:'模型采样',SamplerCustomAdvanced:'模型采样',VAEDecode:'解码视频画面',VAEDecodeAudio:'解码模型音轨',CreateVideo:'组装生成画面',SaveVideo:'保存模型结果',LoadImage:'读取形象首帧',LoadAudio:'读取驱动音频'};

// 观察连接不提交任务，也不决定任务成败；最终状态始终由原历史查询确认。
class ComfyProgress{
 constructor({baseUrl,clientId,graph,signal,onActivity,segmentIndex,segmentCount}){
  this.graph=graph;this.signal=signal;this.onActivity=onActivity;this.segmentIndex=segmentIndex;this.segmentCount=segmentCount;
  this.buffer=[];this.retired=new Set();this.promptId='';this.closed=false;this.state='waiting';
  this.url=new URL(baseUrl+'/ws');this.url.protocol='ws:';this.url.searchParams.set('clientId',clientId);
 }
 async open(){
  if(this.closed||this.signal?.aborted)return this;
  this.abort=()=>this.close();this.signal?.addEventListener('abort',this.abort,{once:true});
  await new Promise(resolve=>{
   let timer;const ready=()=>{clearTimeout(timer);resolve();};
   try{
    this.socket=new WebSocket(this.url);
    timer=setTimeout(()=>{this.state='unavailable';this.stopSocket();ready();},1500);timer.unref?.();
    this.socket.addEventListener('open',()=>{this.opened=true;ready();},{once:true});
    this.socket.addEventListener('message',event=>this.receive(event.data));
    this.socket.addEventListener('error',()=>{this.state=this.opened?'disconnected':'unavailable';this.connectionLost();ready();});
    this.socket.addEventListener('close',()=>{if(this.state!=='unavailable')this.state='disconnected';this.connectionLost();ready();});
    this.ready=ready;
   }catch{this.state='unavailable';ready();}
  });return this;
 }
 bind(promptId){
  if(this.closed||typeof promptId!=='string'||!promptId)return;
  if(this.promptId&&this.promptId!==promptId)throw Error('进度观察不能切换到另一个模型任务');
  if(this.promptId)return;this.promptId=promptId;this.publish({phase:this.state});
  for(const message of this.buffer)this.accept(message);this.buffer=[];this.check();
 }
 receive(data){
  if(this.closed||typeof data!=='string'||data.length>65536)return;
  let message;try{message=JSON.parse(data);}catch{return;}
  if(!['executing','progress','execution_success'].includes(message?.type)||!message.data||typeof message.data.prompt_id!=='string')return;
  if(!this.promptId){if(this.buffer.length===64)this.buffer.shift();this.buffer.push(message);return;}
  this.accept(message);
 }
 accept({type,data}){
  if(this.closed||this.completed||data.prompt_id!==this.promptId)return;
  if(type==='execution_success'){this.completed=true;this.publish({phase:'collecting'});return;}
  if(typeof data.node!=='string'||!Object.hasOwn(this.graph,data.node)||this.retired.has(data.node))return;
  const node=data.node,nodeLabel=labels[this.graph[node].class_type]||'模型执行中';
  if(type==='executing'){
   if(this.node===node)return;
   if(this.node)this.retired.add(this.node);this.node=node;this.step=undefined;this.total=undefined;
   this.publish({phase:'executing',node,nodeLabel});return;
  }
  const {value,max}=data;
  if(!Number.isInteger(value)||!Number.isInteger(max)||max<=0||max>10000000||value<0||value>max)return;
  if(this.node&&this.node!==node||this.total!==undefined&&(this.total!==max||value<=this.step))return;
  this.node=node;this.step=value;this.total=max;
  // 只有真实采样节点才使用“采样”文字，其他节点保留自己的阶段。
  this.publish({phase:['SamplerCustomAdvanced','KSampler'].includes(this.graph[node].class_type)?'sampling':'executing',node,nodeLabel,value,max});
 }
 publish(details){
  if(this.closed||!this.promptId||this.failure)return;
  const activity={kind:'comfy-h3-activity-v1',promptId:this.promptId,...details,observedAt:new Date().toISOString(),...(this.segmentIndex!==undefined?{segmentIndex:this.segmentIndex,segmentCount:this.segmentCount}:{})};
  try{this.onActivity?.(activity);}catch(error){this.failure=error;this.stopSocket();}
 }
 connectionLost(){if(!this.closed&&!this.completed&&this.promptId)this.publish({phase:this.state});}
 check(){if(this.failure)throw this.failure;}
 collecting(){this.check();this.publish({phase:'collecting'});this.check();}
 stopSocket(){try{this.socket?.close();}catch{}}
 close(){if(this.closed)return;this.closed=true;this.buffer=[];this.signal?.removeEventListener('abort',this.abort);this.ready?.();this.stopSocket();}
}
async function observeComfy(options){const observer=new ComfyProgress(options);await observer.open();return observer;}
module.exports={ComfyProgress,observeComfy};
