<script setup>
import {mediaUrl} from '../api';
import {ref,watch} from 'vue';
import I from './Icon.vue';
const props=defineProps({option:Object,label:String});
const failed=ref(false),posterFailed=ref(false);
watch(()=>[props.option?.assetId,props.option?.posterId],()=>{failed.value=false;posterFailed.value=false;});
function seek(event){const video=event.target;if(Number.isFinite(video.duration)&&video.duration>0)video.currentTime=Math.min(.05,video.duration/2);}
</script>
<template><span class="avatar-choice"><span class="avatar-choice-preview"><img v-if="option?.posterId&&!posterFailed" :key="option.posterId" :src="mediaUrl(option.posterId)" alt="" @error="posterFailed=true"/><video v-else-if="option?.assetId&&!failed" :key="option.assetId" :src="mediaUrl(option.assetId)" muted playsinline preload="metadata" aria-hidden="true" @loadedmetadata="seek" @error="failed=true"/><I v-else name="User" :size="20"/></span><span>{{option?.label||label||'请选择形象'}}</span></span></template>
