<script setup>
import {ref,watch} from 'vue';
import AInput from 'ant-design-vue/es/input';
const props=defineProps({modelValue:String,label:String,antInput:Boolean});const emit=defineEmits(['update:modelValue']);const input=ref(props.modelValue);
watch(()=>props.modelValue,value=>input.value=value);
function commit(){if(/^#[\da-f]{6}$/i.test(input.value))emit('update:modelValue',input.value.toUpperCase());else input.value=props.modelValue;}
</script>
<template><label class="cover-color"><span>{{label}}</span><span><input type="color" :aria-label="label" :value="modelValue" @input="emit('update:modelValue',$event.target.value.toUpperCase())"/><AInput v-if="antInput" v-model:value="input" size="small" :aria-label="label+'十六进制'" :maxlength="7" @blur="commit" @pressEnter="commit"/><input v-else v-model="input" :aria-label="label+'十六进制'" maxlength="7" @change="commit" @keydown.enter="commit"/></span></label></template>
