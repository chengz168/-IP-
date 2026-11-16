<script setup>
import {onMounted,onUnmounted,ref,watch} from 'vue';
import {call} from '../api';
const props=defineProps({template:Object,selected:Boolean,fontDirectory:String});
defineEmits(['select']);
const element=ref(null),data=ref(''),error=ref(''),loading=ref(false);
let observer,visible=false,version=0;
async function load(){
  if(!visible||data.value||loading.value)return;
  const current=++version;loading.value=true;error.value='';
  try{const result=await call('previewSubtitleTemplate',{templateId:props.template.id});if(current===version)data.value=result.dataUrl;}
  catch(e){if(current===version)error.value=e.message;}
  finally{if(current===version)loading.value=false;}
}
watch(()=>props.fontDirectory,()=>{version++;data.value='';error.value='';loading.value=false;load();});
onMounted(()=>{observer=new IntersectionObserver(entries=>{visible=entries.some(e=>e.isIntersecting);if(visible)load();},{root:element.value.closest('.subtitle-panel-scroll'),rootMargin:'120px'});observer.observe(element.value);});
onUnmounted(()=>{version++;observer?.disconnect();});
</script>
<template>
  <button ref="element" class="subtitle-template-card" :class="{selected}" :aria-label="template.name" :aria-pressed="selected" :title="error||template.description" @click="$emit('select',template)">
    <strong>{{template.name}}</strong>
    <span class="subtitle-template-sample"><img v-if="data" :src="data" :alt="template.name+'动画小样'"/><span v-else class="subtitle-template-placeholder">{{error?'预览不可用':loading?'正在生成预览…':'动画预览'}}</span></span>
  </button>
</template>
<style scoped>
.subtitle-template-card{display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;gap:4px;min-width:0;width:100%;padding:8px 12px 12px;border:1px solid #ffffff06;border-radius:16px;background:#ffffff01;text-align:left;white-space:normal}
.subtitle-template-card:hover{border-color:#675878;background:#ffffff05}.subtitle-template-card.selected{border-color:#1aa4d1;background:#2a3a55}
.subtitle-template-card>strong{font-size:var(--app-font-size-body);line-height:24px;min-height:24px;overflow-wrap:anywhere}
.subtitle-template-sample{display:flex;width:100%;aspect-ratio:268/150;overflow:hidden;align-items:center;justify-content:center;border-radius:10px;background:#000}
.subtitle-template-sample>img{display:block;width:100%;height:100%;object-fit:contain}.subtitle-template-placeholder{padding:8px;font-size:var(--app-font-size-micro);color:#a8aec0;text-align:center;line-height:1.5}
@media(max-width:1230px){.subtitle-template-card{padding:8px;gap:5px}.subtitle-template-card>strong{font-size:var(--app-font-size-caption);line-height:22px}}
</style>
