<script setup>
import {ref,watch,useId} from 'vue';
import DropdownSelect from './DropdownSelect.vue';
const props=defineProps({modelValue:[String,Number],label:{type:String,default:'字数限制'},variant:{type:String,default:'standard'}});
const emit=defineEmits(['update:modelValue']);
const presets=['200','300','500','800','1000'];
const custom=ref(!presets.includes(String(props.modelValue)));
const inputId=useId();
watch(()=>props.modelValue,value=>{if(!presets.includes(String(value)))custom.value=true;});
function select(value){
  custom.value=value==='custom';
  emit('update:modelValue',custom.value?'500':value);
}
</script>
<template>
  <div class="word-limit-control">
    <label :for="inputId">{{label}}</label>
    <div class="word-limit-inputs">
      <DropdownSelect :id="inputId" aria-label="字数限制" :variant="variant" :model-value="custom?'custom':String(modelValue)" :options="[...presets.map(value=>({value,label:value+'字'})),{value:'custom',label:'自定义'}]" @update:model-value="select"/>
      <input v-if="custom" :value="modelValue" type="number" min="1" step="1" aria-label="自定义字数" @input="emit('update:modelValue',$event.target.value)"/>
      <span v-if="custom">字</span>
    </div>
  </div>
</template>
<style scoped>
.word-limit-control{display:flex;flex-direction:column;gap:6px;min-width:0}
.word-limit-control>label{margin:0}
.word-limit-inputs{display:flex;align-items:center;gap:8px;min-width:0}
.word-limit-inputs .studio-select,.word-limit-inputs input{min-width:0;width:100%;flex:1}
</style>
