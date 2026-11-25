<script setup>
import {computed,inject,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import Modal from './Modal.vue';
import I from './Icon.vue';
import {call,mediaUrl} from '../api';
const emit=defineEmits(['close','select']);
const {draft,state,busy,workflowLocked,act,refresh,notify}=inject('studio');
const taskId=draft.value.id,items=ref([]),filter=ref('全部'),loading=ref(true),working=ref(false),stopping=ref(false),cancelled=ref(false),error=ref(''),status=ref(''),audition=ref(),playing=ref('');
const shown=computed(()=>items.value.filter(p=>filter.value==='全部'||p.gender===filter.value));
const missing=computed(()=>items.value.filter(p=>!p.ready));
const locked=computed(()=>!!busy.value||working.value||workflowLocked.value||draft.value.id!==taskId);
const canGenerate=computed(()=>!!state.value.settings.provider.voiceDesignHome);
const activeRun=computed(()=>state.value.runs.find(r=>r.draftId===taskId&&r.type==='voice-design'&&r.status==='running'));
async function load(){try{items.value=await call('listVoicePresets');}catch(cause){error.value=cause.message;}finally{loading.value=false;}}
function stopAudio(){audition.value?.pause();playing.value='';}
async function preview(item){if(playing.value===item.id){stopAudio();return;}stopAudio();playing.value=item.id;await nextTick();try{audition.value.src=mediaUrl(item.sampleId);await audition.value.play();}catch{playing.value='';error.value='试听文件无法播放，请重新生成此预设。';}}
function use(item){if(locked.value||!item.ready)return;stopAudio();emit('select',item.voiceId);emit('close');}
async function prepare(targets){
 if(locked.value||!canGenerate.value)return;stopAudio();working.value=true;cancelled.value=false;error.value='';let completed=0;
 try{
  const result=await act('添加预设声音',async()=>{
   for(const item of targets){if(cancelled.value)break;status.value=`正在生成${completed+1}/${targets.length}：${item.name}`;
    try{await call('prepareVoicePreset',{id:taskId,presetId:item.id});completed++;await refresh();await load();}catch(cause){if(!cancelled.value)error.value=cause.message;throw cause;}
   }
   return {completed};
  });
  if(result&&completed)notify(`已添加${completed}种预设声音，可试听后选择使用`,'success');
 }finally{working.value=false;status.value='';}
}
async function stop(){if(stopping.value)return;cancelled.value=true;stopping.value=true;status.value='正在停止生成，已添加的音色会保留';try{const current=await call('state'),run=current.runs.find(r=>r.draftId===taskId&&r.type==='voice-design'&&r.status==='running');if(run)await call('cancelRun',{id:run.id});await refresh();}catch(cause){error.value=cause.message;}finally{stopping.value=false;}}
// 停止发生在任务登记前时，等新任务进入运行态后补发取消，避免漏掉首个进程。
watch(activeRun,run=>{if(cancelled.value&&working.value&&run&&!stopping.value)stop();});
onMounted(load);onBeforeUnmount(stopAudio);
</script>
<template>
 <Modal title="预设声音" variant="voice-presets" :close-disabled="working" :mask-closable="!working" @close="stopAudio();emit('close')">
  <p class="voice-preset-intro">按场景试听音色，选择“使用”后应用到当前任务。预设由本地模型独立设计，实际效果请以试听为准。</p>
  <div class="voice-preset-toolbar"><div role="group" aria-label="音色筛选"><button v-for="kind in ['全部','女声','男声']" :key="kind" :class="{active:filter===kind}" :aria-pressed="filter===kind" @click="filter=kind">{{kind}}</button></div><span>已添加 {{items.filter(p=>p.ready).length}} / {{items.length}}</span></div>
  <p v-if="loading" role="status">正在读取预设声音…</p>
  <div v-else class="voice-preset-grid">
   <article v-for="item in shown" :key="item.id" class="voice-preset-card" :aria-label="item.name" :class="{selected:draft.voice.profile===item.voiceId&&item.ready}">
    <div class="voice-preset-title"><strong>{{item.name}}</strong><span>{{item.scene}}</span></div><p>{{item.description}}</p>
    <div class="voice-preset-actions"><template v-if="item.ready"><button :disabled="working" :aria-label="(playing===item.id?'停止试听':'试听')+item.name" @click="preview(item)"><I :name="playing===item.id?'Square':'PlayCircle'" :size="15"/>{{playing===item.id?'停止试听':'试听'}}</button><button class="primary" :disabled="locked" :aria-label="'使用'+item.name" @click="use(item)">{{draft.voice.profile===item.voiceId?'当前音色':'使用'}}</button></template><button v-else :disabled="locked||!canGenerate" :aria-label="'添加'+item.name" @click="prepare([item])">生成并添加</button></div>
   </article>
  </div>
  <audio ref="audition" class="voice-preset-audio" :class="{visible:playing}" controls preload="none" aria-label="预设音色试听" @ended="playing=''" @error="playing='';error='试听文件无法播放，请检查本地样本。'"/>
  <p v-if="error" class="voice-error" role="alert">{{error}}</p>
  <p v-if="!canGenerate&&missing.length" class="hint">生成新预设需要在模型设置中配置本地“自主音色环境”。已添加的音色可继续试听使用。</p>
  <template #footer><template v-if="working"><span class="voice-preset-status" role="status"><I name="LoaderCircle" class="spin" :size="16"/>{{status}}</span><button :disabled="stopping" @click="stop">{{stopping?'正在停止…':'停止生成'}}</button></template><template v-else><span class="voice-preset-footer-note">生成只需执行一次，之后可在声音下拉框直接选择。</span><button @click="stopAudio();emit('close')">关闭</button><button v-if="missing.length" class="primary" :disabled="locked||loading||!canGenerate" @click="prepare([...missing])">添加全部预设</button></template></template>
 </Modal>
</template>
