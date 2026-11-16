<script setup>
import {computed} from 'vue';
const props=defineProps({modelValue:Number,label:String,displayLabel:String,min:{type:Number,default:0},max:Number,step:{type:Number,default:1},suffix:{type:String,default:''},valueOnly:{type:Boolean,default:false}});
const emit=defineEmits(['update:modelValue']);
// 百分比换算产生的浮点尾数仅在显示时舍入，不改写保存参数。
const displayValue=computed(()=>Number.isFinite(props.modelValue)?Number(props.modelValue.toFixed(6)):props.modelValue);
function update(event){if(event.target.value==='')return;const value=Number(event.target.value);if(Number.isFinite(value))emit('update:modelValue',Math.min(Number(event.target.max),Math.max(Number(event.target.min),value)));}
</script>
<template><label class="cover-range"><span>{{displayLabel||label}}</span><input type="range" :aria-label="label" :value="modelValue" :min="min" :max="max" :step="step" :style="{'--range-progress':Math.max(0,Math.min(100,(modelValue-min)/(max-min)*100))+'%'}" @input="update"/><span v-if="valueOnly" class="cover-range-value readonly-value" :aria-label="label+'数值'">{{displayValue}}{{suffix}}</span><span v-else class="cover-range-value"><input type="number" :aria-label="label+'数值'" :value="displayValue" :min="min" :max="max" :step="step" @change="update"/><small v-if="suffix">{{suffix}}</small></span></label></template>
