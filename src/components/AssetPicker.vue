<script setup>
import {inject,ref,computed} from 'vue';
import Modal from './Modal.vue';
import I from './Icon.vue';
import {mediaUrl} from '../api';
const props=defineProps({kind:{default:'all'},title:{default:'选择素材'}});
const emit=defineEmits(['close','select']);
const {state,importAssets}=inject('studio');const search=ref('');
const assets=computed(()=>state.value.assets.filter(a=>(props.kind==='all'||(props.kind==='visual'&&['video','image'].includes(a.type))||a.type===props.kind||(props.kind==='audio'&&a.type==='video'))&&a.name.includes(search.value)).slice().reverse());
async function upload(){const items=await importAssets(props.kind);if(items.length)emit('select',items[0]);}
</script>
<template><Modal :title="title" wide @close="emit('close')"><div class="toolbar"><div class="search"><I name="Search"/><input v-model="search" placeholder="搜索素材名称" aria-label="搜索素材名称"/></div><button class="primary" @click="upload"><I name="Upload"/>导入本地文件</button></div><div v-if="assets.length" class="asset-grid picker-grid"><button v-for="a in assets" :key="a.id" class="asset-card" @click="emit('select',a)"><img v-if="a.type==='image'" :src="mediaUrl(a.id)" alt=""/><div v-else class="asset-thumbnail"><I :name="a.type==='audio'?'Volume2':a.type==='video'?'Video':'FileText'" :size="36"/></div><strong>{{a.name}}</strong><small>{{(a.size/1024/1024).toFixed(2)}} MB</small></button></div><div v-else class="empty-state"><I name="FolderOpen" :size="48"/><h3>还没有可选素材</h3><p>导入本地文件后，即可用于当前创作任务。</p></div></Modal></template>
