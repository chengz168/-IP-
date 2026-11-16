<script setup>
import {ref,computed,onMounted,onBeforeUnmount,watch} from 'vue';
import I from './Icon.vue';
import {mediaUrl} from '../api';
import {createDriverAudioTransport,readWaveformBytes,waveformPeaks,waveformByteLimit} from '../driver-audio.mjs';
const props=defineProps({id:String,name:String,size:Number,disabled:Boolean});
const emit=defineEmits(['choose']);
const host=ref(),canvas=ref(),position=ref({playing:false,pending:false,currentTime:0,duration:0,error:''}),waveError=ref('');
const time=value=>{const n=Math.max(0,Math.floor(value||0));return Math.floor(n/60)+':'+String(n%60).padStart(2,'0');};
const progress=computed(()=>position.value.duration?Math.min(100,position.value.currentTime/position.value.duration*100):0);
const description=computed(()=>waveError.value||time(position.value.currentTime)+' / '+time(position.value.duration));
let transport,observer,request,context,peaks,frame=0,alive=true,started=false;
function draw(){
 const node=canvas.value;if(!node)return;
 const box=node.getBoundingClientRect(),ratio=window.devicePixelRatio||1,width=box.width,height=30;
 node.width=Math.round(width*ratio);node.height=Math.round(height*ratio);const ctx=node.getContext('2d');ctx.scale(ratio,ratio);ctx.clearRect(0,0,width,height);if(!peaks)return;
 const count=Math.max(1,Math.floor(width/4)),duration=position.value.duration,current=transport?.audio?.currentTime||0,played=duration?current/duration*width:0;
 for(let bar=0;bar<count;bar++){
  let peak=0;for(let bin=Math.floor(bar*peaks.length/count);bin<Math.max(Math.floor((bar+1)*peaks.length/count),Math.floor(bar*peaks.length/count)+1);bin++)peak=Math.max(peak,peaks[bin]||0);
  const barHeight=peak*height;if(!barHeight)continue;const x=bar*4;ctx.fillStyle=x<played?'#d76bfa':'rgba(181,135,242,0.32)';ctx.beginPath();ctx.roundRect(x,(height-barHeight)/2,2,barHeight,Math.min(2,barHeight/2));ctx.fill();
 }
}
async function wave(){
 if(started||!alive||!transport?.audio?.duration)return;started=true;
 if(props.size>waveformByteLimit||transport.audio.duration>600){waveError.value='音频较大，仅显示播放进度；仍可试听和定位';return;}
 request=new AbortController();const timer=setTimeout(()=>request.abort(),30000);
 try{
  const response=await fetch(mediaUrl(props.id),{signal:request.signal}),bytes=await readWaveformBytes(response,{signal:request.signal});
  if(!alive||request.signal.aborted)return;
  context=new AudioContext({sampleRate:8000});const buffer=await context.decodeAudioData(bytes);
  if(!alive||request.signal.aborted)return;if(buffer.duration>600)throw Error('音频超过波形预览时长限制');
  peaks=waveformPeaks(buffer.getChannelData(0));draw();
 }catch(error){if(alive)waveError.value='波形暂不可用，仍可试听和定位';}
 finally{clearTimeout(timer);if(context){await context.close().catch(()=>{});context=null;}}
}
function animate(){draw();if(alive&&position.value.playing)frame=requestAnimationFrame(animate);}
function choose(){transport?.pause();emit('choose');}
function seek(event){const rect=event.currentTarget.getBoundingClientRect();transport?.seek((event.clientX-rect.left)/rect.width*position.value.duration);}
function key(event){const value=event.key==='Home'?0:event.key==='End'?position.value.duration:['ArrowLeft','ArrowDown'].includes(event.key)?position.value.currentTime-5:['ArrowRight','ArrowUp'].includes(event.key)?position.value.currentTime+5:null;if(value!==null){event.preventDefault();transport?.seek(value);}}
watch(()=>props.disabled,value=>{if(value)transport?.pause();});
watch(()=>position.value.playing,value=>{cancelAnimationFrame(frame);if(value)animate();else draw();});
onMounted(()=>{
 if(!props.id)return;
 transport=createDriverAudioTransport({createAudio:()=>{const node=document.createElement('audio');node.hidden=true;host.value.appendChild(node);return node;},onState:value=>{position.value=value;draw();if(value.duration>0)void wave();}});
 transport.source(mediaUrl(props.id));observer=new ResizeObserver(draw);observer.observe(canvas.value);
});
onBeforeUnmount(()=>{alive=false;cancelAnimationFrame(frame);observer?.disconnect();request?.abort();transport?.dispose();if(context)void context.close().catch(()=>{});context=null;peaks=null;});
</script>
<template>
 <div ref="host" class="video-audio audio-source-card">
  <div class="audio-source-main"><span :title="name||'未选择驱动音频'">{{name||'未选择驱动音频'}}</span>
   <div v-if="id" class="audio-wave-player">
    <button type="button" class="audio-wave-btn" :aria-label="position.playing||position.pending?'暂停驱动音频':'播放驱动音频'" :title="position.playing||position.pending?'暂停驱动音频':'播放驱动音频'" :disabled="disabled" @click="transport?.toggle()"><I :name="position.playing||position.pending?'PauseCircleOutlined':'PlayCircleOutlined'" :size="22"/></button>
    <div class="audio-waveform" role="slider" aria-label="驱动音频播放位置" tabindex="0" :aria-disabled="disabled||!position.duration" aria-valuemin="0" :aria-valuemax="position.duration" :aria-valuenow="position.currentTime" :aria-valuetext="time(position.currentTime)+' / '+time(position.duration)" :title="description" @click="!disabled&&seek($event)" @keydown="!disabled&&key($event)"><canvas ref="canvas" aria-hidden="true"/><div v-if="waveError" class="audio-wave-progress" :style="{width:progress+'%'}" aria-hidden="true"/></div>
    <button class="select-audio-btn" type="button" :disabled="disabled" @click="choose">选取音频</button>
   </div>
  </div>
  <button v-if="!id" class="select-audio-btn" type="button" :disabled="disabled" @click="choose">选取音频</button>
  <p v-if="position.error" class="driver-audio-error" role="alert">{{position.error}}</p>
  <p v-else-if="waveError" class="driver-audio-note" role="status">{{waveError}}</p>
 </div>
</template>
