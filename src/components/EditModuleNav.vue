<script setup>
import {computed,inject} from 'vue';
import {bgmSummary} from '../../server/bgm-model.mjs';
const props=defineProps({modelValue:String,titleSummary:String,subtitleSummary:String});
const emit=defineEmits(['update:modelValue']);
const {draft:d,state}=inject('studio');
const modules=computed(()=>[
 {key:'params',label:'音视频参数',summary:`${d.value.edit.volume.toFixed(1)} 人声 · ${d.value.edit.speed.toFixed(2)}x`,enabled:true,switchable:false},
 ...[['title','标题'],['subtitles','字幕'],['card','个人名片'],['sfx','音效'],['bgm','背景音乐'],['pip','画中画混剪']].map(([key,label])=>({key,label,enabled:!!d.value.edit[key+'Enabled'],summary:key==='title'?props.titleSummary:key==='subtitles'?props.subtitleSummary:key==='bgm'?bgmSummary(d.value.edit,state.value.assets):d.value.edit[key+'Enabled']?'已开启':'已关闭'}))
]);
</script>
<template>
 <article class="card edit-nav" aria-label="剪辑模块">
  <section v-for="item in modules" :key="item.key" class="edit-nav-item" :class="{active:modelValue===item.key,disabled:!item.enabled}">
   <!-- 选择面板与启停独立，开关不触发导航，关闭的模块仍可编辑设置。 -->
   <button type="button" class="edit-nav-select" :aria-pressed="modelValue===item.key" @click="emit('update:modelValue',item.key)"><span class="edit-nav-copy"><b>{{item.label}}</b><small :title="item.summary">{{item.summary}}</small></span></button>
   <span v-if="item.switchable!==false" class="edit-nav-switch"><input v-model="d.edit[item.key+'Enabled']" :aria-label="'启用'+item.label" type="checkbox"/></span>
  </section>
 </article>
</template>
