<script setup>
import {computed,inject,onMounted,onBeforeUnmount,ref,watch} from 'vue';
import Modal from './Modal.vue';
import AvatarSelect from './AvatarSelect.vue';
import I from './Icon.vue';
import {call} from '../api';
import {distributeShotDurations,moveShot,shotInputSignature,shotTotal,validateShots} from '../../server/video-shots.mjs';
const props=defineProps({signature:String});
const emit=defineEmits(['close']);
const {state,draft,busy,workflowLocked,save,refresh,notify}=inject('studio');
const draftId=draft.value.id,rows=ref(draft.value.video.shots.map(shot=>({...shot,key:crypto.randomUUID()}))),error=ref(''),saving=ref(false),audio=ref(null),audioLoading=ref(true),overlay=ref({}),dragged=ref(null);
const locked=computed(()=>saving.value||!!busy.value||workflowLocked.value),total=computed(()=>shotTotal(rows.value));
let observer;
function position(){const stage=document.querySelector('.stage-3');if(!stage)return;const r=stage.getBoundingClientRect(),margin=parseFloat(getComputedStyle(stage).marginRight)||0;overlay.value={left:r.left+'px',top:r.top+'px',right:(innerWidth-r.right-margin)+'px',bottom:(innerHeight-r.bottom)+'px'};}
function close(){if(!saving.value)emit('close');}
function add(){if(locked.value)return;rows.value.push({key:crypto.randomUUID(),avatarId:draft.value.video.avatarId||state.value.avatars[0]?.id||'',duration:10});error.value='';}
function move(from,to){if(locked.value)return;rows.value=moveShot(rows.value,from,to);}
function distribute(){if(locked.value||!audio.value)return;try{const durations=distributeShotDurations(audio.value.duration,rows.value.length);rows.value.forEach((row,index)=>row.duration=durations[index]);error.value='';}catch(e){error.value=e.message;}}
function drop(event,to){event.preventDefault();const from=dragged.value;dragged.value=null;if(from!==null)move(from,to);}
async function confirm(){
 if(locked.value)return;
 try{const shots=validateShots(rows.value,state.value.avatars);if(shotInputSignature(draft.value)!==props.signature)throw new Error('视频输入已变化，请重新打开镜头配置');saving.value=true;error.value='';await save();await call('saveVideoShots',{id:draftId,shots,signature:props.signature});await refresh(true);notify('多镜头配置已保存','success');emit('close');}catch(e){error.value='保存镜头失败：'+e.message;}finally{saving.value=false;}
}
watch(()=>[draft.value.id,shotInputSignature(draft.value),workflowLocked.value],()=>{if(!saving.value&&(draft.value.id!==draftId||shotInputSignature(draft.value)!==props.signature||workflowLocked.value))emit('close');});
onMounted(async()=>{position();window.addEventListener('resize',position);const stage=document.querySelector('.stage-3');if(stage){observer=new ResizeObserver(position);observer.observe(stage);}try{audio.value=await call('videoAudioInfo',{id:draftId});}catch(e){error.value=e.message;}finally{audioLoading.value=false;}});
onBeforeUnmount(()=>{observer?.disconnect();window.removeEventListener('resize',position);});
</script>
<template>
 <Modal title="配置多镜头" variant="video-shots" :backdrop-style="overlay" @close="close">
  <template #header-actions><div class="shot-header-actions"><button class="shot-distribute" :disabled="locked||audioLoading||!audio||!rows.length" :title="audio?'按实际驱动音频'+audio.duration+'秒分配':'请先选择有音轨和有效时长的驱动音频'" @click="distribute">按音频平均分配</button><button class="shot-add" :disabled="locked" @click="add"><I name="Plus" :size="17"/>添加镜头</button></div></template>
  <p v-if="error" class="shot-error" role="alert">{{error}}</p>
  <div class="shot-list" role="list" aria-label="镜头配置列表"><div v-for="(row,index) in rows" :key="row.key" class="shot-row" role="listitem" :class="{dragging:dragged===index}" @dragover.prevent @drop="drop($event,index)"><span class="shot-label"><span class="shot-grip" :draggable="!locked" :tabindex="locked?-1:0" role="button" :aria-label="'拖动镜头'+(index+1)+'排序'" title="拖动排序；也可使用右侧上移、下移按钮" @dragstart="event=>{dragged=index;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',String(index))}" @dragend="dragged=null" @keydown.alt.up.prevent="move(index,index-1)" @keydown.alt.down.prevent="move(index,index+1)"><I name="GripVertical" :size="12"/></span>镜头 {{index+1}}</span><AvatarSelect v-model="row.avatarId" :disabled="locked" :aria-label="'镜头'+(index+1)+'形象'"/><label class="shot-duration"><input v-model.number="row.duration" type="number" min="0.1" step="0.1" :disabled="locked" :aria-label="'镜头'+(index+1)+'时长'"/><span>秒</span></label><div class="shot-actions"><button :disabled="locked||index===0" :aria-label="'上移镜头'+(index+1)" @click="move(index,index-1)"><I name="ArrowLeft" class="shot-up" :size="18"/></button><button :disabled="locked||index===rows.length-1" :aria-label="'下移镜头'+(index+1)" @click="move(index,index+1)"><I name="ArrowRight" class="shot-down" :size="18"/></button><button class="shot-remove" :disabled="locked" :aria-label="'删除镜头'+(index+1)" @click="rows.splice(index,1)"><I name="Trash2" :size="18"/></button></div></div><p v-if="!rows.length" class="shot-empty">暂无镜头，请点击“添加镜头”。</p></div>
  <template #footer><span class="shot-total">共 {{rows.length}} 个镜头，总时长约 {{total}} 秒</span><button class="shot-cancel" :disabled="saving" @click="close">取消</button><button class="shot-confirm" :disabled="locked" @click="confirm">{{saving?'保存中…':'确定'}}</button></template>
 </Modal>
</template>
