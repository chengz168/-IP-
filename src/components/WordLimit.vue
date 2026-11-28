<script setup>
import {computed,inject,ref,watch,useId} from 'vue';
import DropdownSelect from './DropdownSelect.vue';
import {estimateWordDuration} from '../word-duration-estimate.mjs';
const props=defineProps({modelValue:[String,Number],label:{type:String,default:'字数限制'},variant:{type:String,default:'standard'}});
const emit=defineEmits(['update:modelValue']);
const presets=['200','300','500','800','1000'];
const custom=ref(!presets.includes(String(props.modelValue)));
const inputId=useId();
const studio=inject('studio',null);
const speed=computed(()=>studio?.draft?.value?.voice?.speed??1);
const estimate=computed(()=>estimateWordDuration(props.modelValue,speed.value));
const estimateId=inputId+'-duration';
watch(()=>props.modelValue,value=>{if(!presets.includes(String(value)))custom.value=true;});
function select(value){
  custom.value=value==='custom';
  emit('update:modelValue',custom.value?'500':value);
}
</script>
<template>
  <div class="word-limit-control">
    <label :for="inputId" class="word-limit-heading"><span>{{label}}</span><small :id="estimateId" class="word-duration-estimate" :title="estimate?.explanation||'请输入正整数字数后估算视频时长。'" aria-live="polite">{{estimate?.text||'视频时长待估算'}}</small></label>
    <div class="word-limit-inputs">
      <DropdownSelect :id="inputId" aria-label="字数限制" :aria-describedby="estimateId" :variant="variant" :model-value="custom?'custom':String(modelValue)" :options="[...presets.map(value=>({value,label:value+'字'})),{value:'custom',label:'自定义'}]" @update:model-value="select"><template #option="{option}"><span class="word-limit-option"><span>{{option.label}}</span><small v-if="option.value!=='custom'">{{estimateWordDuration(option.value,speed)?.text}}</small></span></template></DropdownSelect>
      <input v-if="custom" :value="modelValue" type="number" min="1" step="1" aria-label="自定义字数" :aria-describedby="estimateId" @input="emit('update:modelValue',$event.target.value)"/>
      <span v-if="custom">字</span>
    </div>
  </div>
</template>
<style scoped>
.word-limit-control{display:flex;flex-direction:column;gap:6px;min-width:0}
.word-limit-control>label{margin:0}
.word-limit-heading{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:2px 8px}
.word-duration-estimate{font-size:var(--app-font-size-micro);font-weight:400;color:var(--muted,#a7b3c9);line-height:1.5;overflow-wrap:anywhere}
.word-limit-option{display:flex;flex-direction:column;gap:3px;min-width:0}
.word-limit-option>small{font-size:var(--app-font-size-micro);font-weight:400;line-height:1.5;color:#b9c6df}
.word-limit-inputs{display:flex;align-items:center;gap:8px;min-width:0}
.word-limit-inputs .studio-select,.word-limit-inputs input{min-width:0;width:100%;flex:1}
</style>
