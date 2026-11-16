<script setup>
import {computed,inject} from 'vue';
import I from './Icon.vue';
import {h3ActivityText} from '../../server/h3-activity.mjs';
const props=defineProps({inline:Boolean});
// 两个展示位置复用同一任务与停止状态，切页不会创建第二个执行。
const {busy,activeRecognition,stopPending,stopRecognition}=inject('studio');
const label=computed(()=>busy.value||(activeRecognition.value?.type==='avatar'?'生成数字人视频':'任务处理中'));
const detail=computed(()=>h3ActivityText(activeRecognition.value?.activity)||(activeRecognition.value?Math.round(activeRecognition.value.progress)+'%':'进行中'));
const stopLabel=computed(()=>{
  if(stopPending.value)return '正在停止…';
  return ['extract','transcribe'].includes(activeRecognition.value?.type)?'停止识别':'停止处理';
});
</script>
<template>
  <div v-if="busy||activeRecognition" :class="props.inline?'step-status step-status-operation':'operation-status'" role="status" aria-live="polite" aria-atomic="true" aria-label="当前操作状态">
    <I name="LoaderCircle" class="spin" :size="18"/>
    <strong class="operation-label" :title="label">{{label}}</strong>
    <small class="operation-detail" :title="detail">{{detail}}</small>
    <button v-if="activeRecognition" :disabled="stopPending" @click="stopRecognition">{{stopLabel}}</button>
  </div>
</template>
<style scoped>
.operation-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:inherit;font-weight:500}
.operation-detail{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#c8a8ef;font-size:inherit}
.step-status-operation{justify-content:flex-start;gap:8px;background:#352d48;border-color:#66518b;color:#eee7ff;padding:0 10px}
.step-status-operation>.operation-label{flex:0 1 auto}
.step-status-operation>.operation-detail{flex:1;text-align:left}
.step-status-operation>button{flex-shrink:0;min-height:28px;margin-left:auto;padding:3px 10px;font-size:var(--app-font-size-micro)}
.step-status-operation>.spin{flex-shrink:0}
@media(max-width:1150px){.step-status-operation{gap:6px;padding:0 8px}.step-status-operation>.operation-label{max-width:38%}.step-status-operation>button{padding:3px 8px}}
</style>
