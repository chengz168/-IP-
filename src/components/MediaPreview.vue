<script setup>
import {ref,watch} from 'vue';
import I from './Icon.vue';
import {mediaUrl} from '../api';
const props=defineProps({id:String,type:{default:'video'},title:{default:'暂无预览视频'},description:{default:'生成后将在此处显示预览'},poster:String,emptyIcon:String});
const phase=ref('loading'),attempt=ref(0),media=ref();
// 换源重建播放器；旧节点迟到的事件不能改变当前素材状态。
watch(()=>[props.id,props.type],()=>{phase.value='loading';attempt.value=0;},{flush:'sync'});
function loaded(event){if(event.target===media.value)phase.value='ready';}
function failed(event){if(event.target===media.value)phase.value='error';}
function retry(){phase.value='loading';attempt.value++;}
</script>
<template><div class="media-preview" :class="[type,{filled:!!id}]" :aria-busy="!!id&&phase==='loading'">
 <div v-if="id&&phase==='error'" class="empty-media media-preview-error" role="alert"><I name="CircleAlert" :size="32"/><strong>素材加载失败</strong><p>请检查文件是否仍可用，或重新选择素材。</p><button type="button" @click="retry"><I name="RefreshCw" :size="16"/>重新加载</button></div>
 <template v-else-if="id"><video v-if="type==='video'" ref="media" :key="id+':'+attempt" controls preload="metadata" :src="mediaUrl(id)" :poster="poster" @loadedmetadata="loaded" @error="failed"/><audio v-else-if="type==='audio'" ref="media" :key="id+':'+attempt" controls preload="metadata" :src="mediaUrl(id)" @loadedmetadata="loaded" @error="failed"/><img v-else ref="media" :key="id+':'+attempt" :src="mediaUrl(id)" alt="素材预览" @load="loaded" @error="failed"/><span v-if="phase==='loading'" class="media-preview-loading" role="status"><I name="LoaderCircle" class="spin" :size="16"/>正在加载素材…</span></template>
 <div v-else class="empty-media"><I :name="emptyIcon||(type==='audio'?'Volume2':type==='image'?'Image':'Video')" :size="48"/><strong>{{title}}</strong><p>{{description}}</p></div>
</div></template>
