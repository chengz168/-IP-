<script setup>
import {computed,useId} from 'vue';
const props=defineProps({modelValue:{type:String,default:''},label:{type:String,required:true},models:{type:Array,default:()=>[]},phase:{type:String,default:'idle'},message:{type:String,default:''},allowManual:Boolean,disabled:Boolean,fixed:Boolean});
const emit=defineEmits(['update:modelValue','refresh','cancel']);
const id=useId();
const listed=computed(()=>props.models.some(model=>model.id===props.modelValue));
const selectedModel=computed(()=>props.models.find(model=>model.id===props.modelValue));
const descriptions={idle:'点击刷新读取当前服务的已有模型。',loading:'正在读取模型列表…',ready:'模型列表已更新，当前选择保持不变。',empty:'未发现可选模型，当前配置已保留。',unavailable:'本机环境尚未齐备，当前配置已保留。',cancelled:'已取消本次读取，当前配置已保留。',error:'读取模型列表失败，当前配置已保留。',timeout:'读取模型列表超时，当前配置已保留。'};
const status=computed(()=>props.message||descriptions[props.phase]||descriptions.idle);
</script>

<template>
  <div class="model-picker" :data-phase="phase" :aria-busy="phase==='loading'">
    <label v-if="!fixed" :for="id+'-models'">{{label}}</label><span v-else>{{label}}（固定引擎）</span>
    <div class="model-picker-controls">
      <select v-if="!fixed" :id="id+'-models'" :aria-label="label+'列表'" :aria-describedby="id+'-status'" :value="modelValue" :disabled="disabled||phase==='loading'||!models.length" @change="emit('update:modelValue',$event.target.value)">
        <option v-if="!modelValue" value="" disabled>请选择已发现的模型</option>
        <option v-else-if="!listed" :value="modelValue">{{modelValue}}（当前配置，未在本次列表中确认）</option>
        <option v-for="model in models" :key="model.id" :value="model.id" :disabled="model.disabled">{{model.label||model.id}}{{model.detail?' · '+model.detail:''}}</option>
      </select>
      <button type="button" :aria-label="'刷新'+label+'列表'" :aria-busy="phase==='loading'" :disabled="disabled||phase==='loading'" @click="emit('refresh')">{{phase==='loading'?'读取中…':'刷新列表'}}</button>
      <button v-if="phase==='loading'" type="button" :aria-label="'取消读取'+label+'列表'" @click="emit('cancel')">取消读取</button>
    </div>
    <ul v-if="fixed&&models.length" class="model-picker-environments"><li v-for="model in models" :key="model.id"><span>{{model.label||model.id}}</span><small>{{model.detail}}</small></li></ul>
    <label v-if="allowManual" :for="id+'-custom'" class="model-picker-custom">自定义{{label}}名<input :id="id+'-custom'" :aria-label="'自定义'+label+'名'" :value="modelValue" :disabled="disabled" autocomplete="off" placeholder="也可填写服务实际提供的模型名称" @input="emit('update:modelValue',$event.target.value)"/></label>
    <p v-else-if="modelValue" class="hint model-picker-current">当前配置：{{modelValue}}</p>
    <p v-if="!fixed&&selectedModel?.detail" class="hint model-picker-current">{{selectedModel.detail}}</p>
    <p :id="id+'-status'" class="hint model-picker-status" :class="{'model-picker-error':['error','timeout'].includes(phase)}" role="status" aria-live="polite">{{status}}</p>
  </div>
</template>

<style scoped>
.model-picker{min-width:0;margin-top:20px}
.model-picker>label{margin:0;line-height:24px}
.model-picker-controls{display:flex;align-items:flex-start;gap:10px;margin-top:8px;min-width:0}
.model-picker-controls>select{flex:1;min-width:0;max-width:100%;text-overflow:ellipsis}
.model-picker-controls>button{flex:none;min-height:34px}
.model-picker .model-picker-custom{margin-top:14px}
.model-picker-current,.model-picker-status{overflow-wrap:anywhere}
.model-picker-status{min-height:22px}
.model-picker .model-picker-error{color:#ffc0b0}
.model-picker-environments{margin:10px 0 0;padding-left:20px;overflow-wrap:anywhere}
.model-picker-environments small{display:block;line-height:1.6}
@media(max-width:1050px){.model-picker-controls{flex-wrap:wrap}.model-picker-controls>select{flex-basis:100%}}
</style>
