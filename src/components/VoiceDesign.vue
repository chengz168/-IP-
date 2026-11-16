<script setup>
import {computed,inject,onMounted,onUnmounted,ref,watch} from 'vue';
import Modal from './Modal.vue';
import I from './Icon.vue';
import {call,mediaUrl} from '../api';
import presets from '../../server/voice-design-presets.json';
import {voiceDesignState,voiceDesignMatches} from '../voice-design-state.mjs';
const emit=defineEmits(['close']);
const {state,draft,busy,workflowLocked,act,refresh,notify}=inject('studio');
const taskId=draft.value.id,name=ref('夜聊女声'),instruct=ref(presets[0].instruct),text=ref('晚上出来走一走，刚好路边的灯都亮了。忙了一天，先给自己留几分钟，慢慢走，也慢慢聊。');
const error=ref(''),working=ref(false),listened=ref(false),saving=ref(false),stopping=ref(false);
const audition=ref(),design=computed(()=>voiceDesignState(state.value,taskId));
const latest=computed(()=>design.value.latest),candidateRun=computed(()=>design.value.candidateRun);
const running=computed(()=>latest.value?.status==='running');
const locked=computed(()=>!!busy.value||working.value||running.value||saving.value||workflowLocked.value||draft.value.id!==taskId);
const candidate=computed(()=>design.value.candidate);
const current=computed(()=>candidate.value&&voiceDesignMatches(candidateRun.value,text.value,instruct.value));
const missingEnvironment=computed(()=>!state.value.settings.provider.voiceDesignHome?.trim());
function stopAudition(){audition.value?.pause();}
function resetAudition(){stopAudition();listened.value=false;}
function restoreCandidate(){if(locked.value||!candidateRun.value)return;const job=candidateRun.value.parameters.job;text.value=job.text;instruct.value=job.instruct;resetAudition();}
function auditionPlay(){if(running.value||working.value)stopAudition();}
watch(()=>candidate.value?.id,resetAudition);
watch([text,instruct],resetAudition);
watch(running,value=>{if(value)resetAudition();});
onUnmounted(stopAudition);
function close(){if(!working.value&&!running.value&&!saving.value){stopAudition();emit('close');}}
async function generate(){
 if(locked.value)return;working.value=true;error.value='';listened.value=false;let failure;
 try{const result=await act('设计新音色',async()=>{try{return await call('designVoice',{id:taskId,job:{text:text.value,instruct:instruct.value,language:'Chinese',seed:20261115,max_new_tokens:1024}});}catch(cause){failure=cause;throw cause;}});if(!result)throw failure||Error('未生成新的声音，请查看任务记录');await refresh();}
 catch(cause){error.value=cause.message;}finally{working.value=false;}
}
async function stop(){if(!running.value||stopping.value)return;stopping.value=true;try{await call('cancelRun',{id:latest.value.id});await refresh();}catch(cause){error.value=cause.message;}finally{stopping.value=false;}}
async function save(){
 if(locked.value||!current.value||!listened.value)return;saving.value=true;error.value='';
 try{const resource=await call('saveDesignedVoice',{id:taskId,assetId:candidate.value.id,name:name.value});await refresh();notify('“'+resource.name+'”已保存，可在声音生成中选择并生成新文案','success');emit('close');}
 catch(cause){error.value=cause.message;}finally{saving.value=false;}
}
onMounted(()=>{const job=latest.value?.parameters?.job;if(job){text.value=job.text;instruct.value=job.instruct;}if(['failed','cancelled','interrupted'].includes(latest.value?.status))error.value=latest.value.error||'上次音色设计未完成，可检查后重新生成';});
</script>
<template>
 <Modal title="设计新音色" variant="voice-design" @close="close">
  <p class="voice-design-intro">描述你想要的声音，先生成一段试听，满意后保存到声音库。</p>
  <p v-if="missingEnvironment" class="voice-error" role="alert">请先在设置 → 模型设置中配置自主音色环境路径。</p>
  <div class="voice-design-fields" :aria-busy="running||working">
   <label for="design-voice-name">声音名称<input id="design-voice-name" v-model="name" maxlength="10" :disabled="locked" placeholder="10字以内"/></label>
   <fieldset :disabled="locked"><legend>音色描述参考</legend><div class="voice-design-presets"><button v-for="preset in presets" :key="preset.id" :class="{active:instruct===preset.instruct}" :aria-pressed="instruct===preset.instruct" @click="instruct=preset.instruct">{{preset.name}}</button></div></fieldset>
   <label for="design-voice-description">音色描述<textarea id="design-voice-description" v-model="instruct" maxlength="1000" :disabled="locked" rows="4" placeholder="例如：成年女声，中音温暖，语气轻松，像和朋友聊天"/><span class="voice-design-count">{{instruct.length}} / 1000</span></label>
   <label for="design-voice-text">试听正文<textarea id="design-voice-text" v-model="text" maxlength="200" :disabled="locked" rows="3"/><span class="voice-design-count">{{text.length}} / 200</span></label>
  </div>
  <p v-if="running||working" class="voice-design-status" role="status"><I name="LoaderCircle" class="spin" :size="17"/>本地模型正在生成声音，请稍候。<button v-if="running" :disabled="stopping" @click="stop">{{stopping?'正在停止…':'停止生成'}}</button></p>
  <p v-if="error" class="voice-error" role="alert">{{error}}</p>
  <div v-if="candidate" class="voice-design-audition"><strong>{{latest?.id===candidateRun?.id?'生成试听':'上次生成试听'}}</strong><audio ref="audition" :key="candidate.id" :src="mediaUrl(candidate.id)" controls preload="metadata" @play="auditionPlay" @ended="listened=true"/><p class="hint">{{current?'请完整试听，检查语气、自然度与人物是否匹配。':'这份试听对应上次成功的输入；当前正文或描述已修改。'}}</p><button v-if="!current" :disabled="locked" @click="restoreCandidate">恢复这份试听的输入</button></div>
  <template #footer><button :disabled="working||running||saving" @click="close">关闭</button><button :disabled="locked||missingEnvironment||!text.trim()||!instruct.trim()" @click="generate"><I name="Volume2" :size="16"/>{{working?'生成中…':'生成试听'}}</button><button class="primary" :disabled="locked||!current||!listened||!name.trim()" :title="!listened?'请先完整试听生成的音频':''" @click="save">{{saving?'保存中…':'保存到声音库'}}</button></template>
 </Modal>
</template>
