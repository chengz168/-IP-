<script setup>
import {computed,onBeforeUnmount,ref,watch} from 'vue';
import {call,mediaUrl} from '../api';
import I from './Icon.vue';
const props=defineProps({sampleId:String,draftId:String,disabled:Boolean});
const emit=defineEmits(['ready']);
const data=ref(null),loading=ref(false),error=ref(''),start=ref(0),end=ref(0),player=ref(null),wave=ref(null),playing=ref(false),processing=ref(false);
const duration=computed(()=>data.value?.duration||0),length=computed(()=>Number(end.value)-Number(start.value));
const valid=computed(()=>!!data.value&&Number.isFinite(Number(start.value))&&Number.isFinite(Number(end.value))&&start.value!==''&&end.value!==''&&Number(start.value)>=0&&Number(end.value)<=duration.value&&length.value>=0.1-1e-9);
const selection=computed(()=>({left:(Number(start.value)||0)/(duration.value||1)*100+'%',width:Math.max(0,length.value)/(duration.value||1)*100+'%'}));
let version=0,mounted=true,dragSide='',dragPointer,dragTarget;
function stop(){player.value?.pause();playing.value=false;}
function releaseDrag(){if(dragTarget?.hasPointerCapture?.(dragPointer))dragTarget.releasePointerCapture(dragPointer);dragTarget=null;dragSide='';}
watch(()=>[props.sampleId,props.draftId],async()=>{
 const mine=++version;stop();releaseDrag();data.value=null;error.value='';emit('ready',false);
 if(!props.sampleId||!props.draftId)return;loading.value=true;
 try{const result=await call('prepareVoiceSample',{id:props.draftId,sampleId:props.sampleId});if(!mounted||mine!==version)return;data.value=result;start.value=0;end.value=Math.min(30,result.duration);}
 catch(e){if(mounted&&mine===version)error.value=e.message;}
 finally{if(mounted&&mine===version)loading.value=false;}
},{immediate:true});
watch([valid,loading,processing],()=>emit('ready',valid.value&&!loading.value&&!processing.value),{immediate:true});
watch([start,end],stop);
watch(()=>props.disabled,value=>{if(value){stop();releaseDrag();}});
function limit(side,value){if(props.disabled||processing.value)return;value=Math.round(value*10)/10;if(side==='start')start.value=Math.max(0,Math.min(Number(end.value)-0.1,value));else end.value=Math.max(Number(start.value)+0.1,Math.min(duration.value,value));}
function drag(event,side){if(props.disabled||processing.value)return;event.preventDefault();dragSide=side;dragPointer=event.pointerId;dragTarget=event.currentTarget;dragTarget.setPointerCapture(event.pointerId);}
function move(event){if(!dragSide||event.pointerId!==dragPointer)return;const rect=wave.value.getBoundingClientRect();limit(dragSide,(event.clientX-rect.left)/rect.width*duration.value);}
function key(event,side){if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(event.key))return;event.preventDefault();const delta=event.key.startsWith('Page')?1:event.shiftKey?1:0.1;let value=Number(side==='start'?start.value:end.value);if(event.key==='Home')value=side==='start'?0:Number(start.value)+0.1;else if(event.key==='End')value=side==='start'?Number(end.value)-0.1:duration.value;else value+=['ArrowLeft','ArrowDown','PageDown'].includes(event.key)?-delta:delta;limit(side,value);}
async function preview(){if(playing.value){stop();return;}if(!valid.value||props.disabled||processing.value)return;error.value='';try{player.value.currentTime=Number(start.value);await player.value.play();playing.value=true;}catch(e){error.value='无法试听选区：'+e.message;}}
function time(){if(player.value&&player.value.currentTime>=Number(end.value)){stop();player.value.currentTime=Number(end.value);}}
async function materialize(){
 if(!valid.value||loading.value)throw Error(error.value||'请先准备声音样本，并检查裁剪范围');
 if(processing.value)throw Error('声音样本正在裁剪，请等待');
 const mine=version,input={id:props.draftId,sampleId:props.sampleId,sourceHash:data.value.sourceHash,start:Number(start.value),end:Number(end.value)},signature=JSON.stringify(input);stop();
 processing.value=true;error.value='';
 try{const asset=await call('trimVoiceSample',input);if(!mounted||mine!==version||signature!==JSON.stringify({...input,start:Number(start.value),end:Number(end.value)}))throw Error('声音来源或选区已变化，本次裁剪未用于保存或训练');return asset;}
 catch(e){if(mounted&&mine===version)error.value=e.message;throw e;}
 finally{if(mounted&&mine===version)processing.value=false;}
}
onBeforeUnmount(()=>{mounted=false;version++;stop();releaseDrag();});
defineExpose({materialize,stop});
</script>
<template>
 <section class="voice-sample-editor" aria-label="音频预览与裁剪" :aria-busy="loading||processing">
  <h4>音频预览与裁剪</h4>
  <p class="voice-sample-advice">建议选取5至30秒清晰、单人的声音。超过30秒时默认选择前30秒。</p>
  <p v-if="loading" class="voice-sample-message" role="status">正在读取音轨与真实波形…</p>
  <template v-if="data">
   <div ref="wave" class="voice-sample-wave" @pointermove="move" @pointerup="releaseDrag" @pointercancel="releaseDrag">
    <img :src="data.waveform" alt="实际音轨波形" class="sample-wave-muted" draggable="false"/>
    <img :src="data.waveform" alt="" class="sample-wave-selected" :style="{clipPath:`inset(0 ${Math.max(0,100-(Number(end)||0)/duration*100)}% 0 ${Math.max(0,(Number(start)||0)/duration*100)}%)`}" draggable="false"/>
    <span class="sample-selection" :style="selection"></span>
    <button class="sample-handle" :style="{left:selection.left}" role="slider" aria-label="裁剪起点" aria-orientation="horizontal" :aria-valuemin="0" :aria-valuemax="Number(end)-0.1" :aria-valuenow="Number(start)" :aria-valuetext="Number(start).toFixed(2)+'秒'" :disabled="disabled||processing" @pointerdown="drag($event,'start')" @keydown="key($event,'start')"><span></span></button>
    <button class="sample-handle" :style="{left:(Number(end)||0)/(duration||1)*100+'%'}" role="slider" aria-label="裁剪终点" aria-orientation="horizontal" :aria-valuemin="Number(start)+0.1" :aria-valuemax="duration" :aria-valuenow="Number(end)" :aria-valuetext="Number(end).toFixed(2)+'秒'" :disabled="disabled||processing" @pointerdown="drag($event,'end')" @keydown="key($event,'end')"><span></span></button>
   </div>
   <div class="sample-time-inputs"><label>开始（秒）<input v-model="start" type="number" min="0" :max="Number(end)-0.1" step="0.1" aria-label="裁剪开始秒数" :disabled="disabled||processing" :aria-invalid="!valid"/></label><label>结束（秒）<input v-model="end" type="number" :min="Number(start)+0.1" :max="duration" step="0.1" aria-label="裁剪结束秒数" :disabled="disabled||processing" :aria-invalid="!valid"/></label></div>
   <div class="sample-preview-actions"><button class="primary" :disabled="!valid||disabled||processing" @click="preview"><I :name="playing?'Square':'Play'" :size="15"/>{{playing?'停止试听':'试听选区'}}</button><output :class="{warning:length<5||length>30}">{{valid?'时长：'+length.toFixed(2)+'秒':'选区无效'}} <span>/ 总长 {{duration.toFixed(2)}}秒</span></output></div>
   <p v-if="!valid" class="voice-error" role="alert">开始时间须大于等于0，结束时间不能超过总长，选区至少为0.1秒。</p>
   <p v-else-if="length<5||length>30" class="voice-sample-message">当前选区超出建议时长，可继续保存；是否适合训练需按实际模型核对。</p>
   <audio ref="player" class="voice-sample-player" :src="mediaUrl(sampleId)" preload="metadata" @timeupdate="time" @ended="stop" @pause="playing=false"/>
  </template>
  <p v-if="processing" class="voice-sample-message" role="status">正在生成所选片段…</p>
  <p v-if="error" class="voice-error" role="alert">{{error}}</p>
 </section>
</template>
