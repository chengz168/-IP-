<script setup>
import ASwitch from 'ant-design-vue/es/switch';
defineProps({title:String,description:String,summary:String,enabled:{type:Boolean,default:undefined},toggleLabel:String});
const emit=defineEmits(['toggle']);
</script>
<template><section class="title-style-group" :class="{effect:enabled!==undefined,enabled:enabled===true}" :aria-label="title"><header><div><h4>{{title}}</h4><p>{{enabled===false?'未启用':description||summary}}</p></div><span v-if="enabled===undefined" class="title-group-summary">{{summary}}</span><ASwitch v-else size="small" :aria-label="toggleLabel||title" :checked="enabled" @change="emit('toggle',$event)"/></header><div v-if="enabled!==false" class="title-group-fields"><slot/></div></section></template>
