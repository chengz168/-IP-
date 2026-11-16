<script setup>
import {computed,inject,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import Modal from './Modal.vue';
import I from './Icon.vue';
import VoiceSampleEditor from './VoiceSampleEditor.vue';
import {call,pickFiles} from '../api';
const emit=defineEmits(['close','saved']);
const {state,draft,busy,workflowLocked,save,refresh,notify,act}=inject('studio');
const localReference=computed(()=>state.value?.settings?.provider?.ttsProtocol==='indextts-local');
const sampleNotice=computed(()=>localReference.value?'样本将作为本地声音生成的参考，无需为每个声音单独训练。视频会先提取音轨；请先检查本地模型环境，并试听生成效果。':'仅保存声音样本，尚未训练克隆音色。视频将先提取音轨；系统配音仍使用本机安装的音色。');
const taskId=draft.value.id,name=ref(''),sample=ref(null),error=ref(''),selecting=ref(false),saving=ref(false),dragging=ref(false),overlay=ref({}),sampleEditor=ref(null),sampleReady=ref(false);
const maxBytes=50*1024*1024,locked=computed(()=>selecting.value||saving.value||!!busy.value||workflowLocked.value);
let observer;
function position(){const stage=document.querySelector('.stage-2');if(!stage)return;const rect=stage.getBoundingClientRect(),margin=parseFloat(getComputedStyle(stage).marginRight)||0;overlay.value={left:rect.left+'px',top:rect.top+'px',right:(innerWidth-rect.right-margin)+'px',bottom:(innerHeight-rect.bottom)+'px'};}
function close(){if(!saving.value&&!selecting.value)emit('close');}
function validate(file){if(!file.size||file.size>maxBytes)throw new Error('文件须大于0且不超过50MB');if(!/\.(mp3|wav|m4a|aac|flac|ogg|mp4|mov|mkv|webm|avi)$/i.test(file.name))throw new Error('请选择支持的音频或视频文件');}
async function choose(){if(locked.value)return;selecting.value=true;error.value='';try{const files=await pickFiles('audio',{multiple:false,maxSize:maxBytes});if(files[0]){validate(files[0]);sample.value=files[0];await refresh();}}catch(e){error.value=e.message;}finally{selecting.value=false;}}
async function drop(event){dragging.value=false;if(locked.value)return;const files=[...event.dataTransfer.files];if(files.length!==1){error.value='请每次选择一个声音样本';return;}error.value='';selecting.value=true;try{validate(files[0]);const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(new Error('无法读取文件'));reader.readAsDataURL(files[0]);});sample.value=await call('importFile',{name:files[0].name,base64});await refresh();}catch(e){error.value=e.message;}finally{selecting.value=false;}}
async function confirm(){if(locked.value)return;if(!name.value.trim()||name.value.trim().length>10){error.value='请填写10字以内的声音名称';return;}if(!sample.value){error.value='请先选择声音文件';return;}saving.value=true;error.value='';let failure;
 try{await save();const result=await act('保存声音样本',async()=>{try{const clip=await sampleEditor.value.materialize();if(draft.value.id!==taskId)throw Error('当前任务已变化，本次裁剪未保存为声音资源');return await call('importVoiceSample',{id:taskId,name:name.value.trim(),sampleId:clip.id});}catch(e){failure=e;throw e;}});if(!result)throw failure||new Error('声音样本未保存，请检查执行记录');await refresh();notify(localReference.value?'所选声音片段已保存，可用作本地配音参考，请试听生成效果':'所选声音片段已保存，尚未训练克隆音色','success');emit('saved',result.resource);emit('close');}catch(e){error.value=e.message;}finally{saving.value=false;}
}
watch(()=>[draft.value.id,workflowLocked.value],()=>{if(!saving.value&&(draft.value.id!==taskId||workflowLocked.value))emit('close');});
onMounted(()=>{position();window.addEventListener('resize',position);const stage=document.querySelector('.stage-2');if(stage){observer=new ResizeObserver(position);observer.observe(stage);}});
onBeforeUnmount(()=>{observer?.disconnect();window.removeEventListener('resize',position);});
</script>
<template>
 <Modal title="上传声音" variant="voice-upload" :backdrop-style="overlay" @close="close">
  <template #header-actions><span class="voice-upload-eyebrow">UPLOAD VOICE</span><p>上传一段音频或视频，保存为可试听的声音样本。</p></template>
  <div class="voice-upload-grid">
   <div class="voice-upload-source" :class="{dragging}" @dragover.prevent="!locked&&(dragging=true)" @dragleave.prevent="dragging=false" @drop.prevent="drop">
    <button v-if="!sample" class="voice-upload-drop" :disabled="locked" @click="choose"><I name="Inbox" :size="36"/><strong>{{selecting?'正在读取文件…':'点击或拖拽音频/视频文件到这里'}}</strong><span>支持 MP3、WAV、M4A、MP4、MOV 等格式，文件不超过 50MB</span></button>
    <div v-else class="voice-upload-selected"><I :name="sample.type==='video'?'Video':'Volume2'" :size="36"/><strong :title="sample.name">{{sample.name}}</strong><p>{{(sample.size/1024/1024).toFixed(2)}} MB</p><VoiceSampleEditor ref="sampleEditor" :sample-id="sample.id" :draft-id="taskId" :disabled="locked" @ready="sampleReady=$event"/><button :disabled="locked" @click="choose">更换文件</button></div>
   </div>
   <div class="voice-upload-form"><label for="voice-sample-name">声音名称</label><input id="voice-sample-name" v-model="name" maxlength="10" :disabled="locked" aria-label="声音名称" placeholder="例如：我的声音"/><span v-if="name" class="voice-name-count">{{name.length}} / 10</span><p class="voice-sample-notice">{{sampleNotice}}</p><p v-if="error" class="voice-error" role="alert">{{error}}</p><button class="primary voice-sample-save" :disabled="locked||!sample||!sampleReady||!name.trim()" @click="confirm"><I name="UploadCloud" :size="17"/>{{saving?'保存中…':'保存声音'}}</button></div>
  </div>
 </Modal>
</template>
