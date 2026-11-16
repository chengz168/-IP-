<script setup>
import {computed,onBeforeUnmount,ref,watch} from 'vue';
import I from './Icon.vue';
import {call} from '../api';
import {AudioRecorderSession,recordingClock} from '../audio-recorder.mjs';
const props=defineProps({draftId:String,disabled:Boolean});
const emit=defineEmits(['recorded','working']);
const status=ref({phase:'idle',seconds:0,error:'',retryable:false});let alive=true;
const active=computed(()=>['requesting','recording','stopping','saving'].includes(status.value.phase));
const label=computed(()=>({requesting:'正在申请麦克风权限…',recording:'停止并保存录音',stopping:'正在结束录音…',saving:'正在校验并保存录音…'})[status.value.phase]||(status.value.retryable?'重试保存录音':'开始录音'));
const current=id=>alive&&props.draftId===id&&!props.disabled;
const recorder=new AudioRecorderSession({onChange:value=>{status.value=value;emit('working',value.retryable||['requesting','recording','stopping','saving'].includes(value.phase));},save:async(blob,id)=>{
 const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('无法读取录音，请重试保存'));reader.onabort=()=>reject(Error('录音读取已取消'));reader.readAsDataURL(blob);});
 if(!current(id))throw Error('页面或任务已变化，录音未提交');
 return call('importRecording',{id,mimeType:blob.type,base64});
},onSaved:(asset,id,reason)=>{if(current(id))emit('recorded',asset,reason);}});
function press(){if(status.value.phase==='recording')return recorder.stop();if(status.value.retryable)return recorder.persist();return recorder.start(props.draftId);}
watch(()=>[props.draftId,props.disabled],()=>{if(active.value||status.value.retryable)recorder.cancel();});
onBeforeUnmount(()=>{alive=false;recorder.dispose();});
</script>
<template>
 <section class="microphone-recorder" :data-phase="status.phase" :aria-busy="['requesting','stopping','saving'].includes(status.phase)" aria-label="直接录音">
  <output class="recording-clock" aria-label="录音时长">{{recordingClock(status.seconds)}}</output>
  <button class="recording-microphone" :class="{recording:status.phase==='recording'}" :disabled="disabled||['requesting','stopping','saving'].includes(status.phase)" :aria-label="label" @click="press"><I :name="status.phase==='recording'?'Square':['requesting','stopping','saving'].includes(status.phase)?'LoaderCircle':'Mic'" :class="{spin:['requesting','stopping','saving'].includes(status.phase)}" :size="30"/></button>
  <p class="recording-status" role="status">{{status.phase==='idle'?'点击开始录音':label}}</p>
  <button v-if="status.phase==='requesting'||status.phase==='recording'||status.retryable" class="text-button recording-cancel" @click="recorder.cancel()">{{status.phase==='requesting'?'取消申请':'放弃本次录音'}}</button>
  <p v-if="status.error" class="voice-error recording-error" role="alert">{{status.error}}</p>
  <small>最长录制120秒，停止后可试听与裁剪。</small>
 </section>
</template>
