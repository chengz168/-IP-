<script setup>
import {ref,useId} from 'vue';
const props=defineProps({modelValue:{type:Array,default:()=>[]}});
const emit=defineEmits(['update:modelValue']);
const input=ref(null),pending=ref(''),composing=ref(false),inputId=useId();
function confirm(){
  const tags=[...props.modelValue];
  for(const part of pending.value.split(/[,\s，、]+/)){
    const tag=part.trim().replace(/^#+/,'').trim();
    if(tag&&!tags.includes(tag))tags.push(tag);
  }
  pending.value='';
  if(tags.length!==props.modelValue.length)emit('update:modelValue',tags);
}
function remove(tag){
  emit('update:modelValue',props.modelValue.filter(value=>value!==tag));
  input.value?.focus();
}
function onKeydown(event){
  // 中文候选词确认期间不消费按键，避免误提交或删除已经保存的标签。
  if(composing.value||event.isComposing||event.keyCode===229)return;
  if(event.key==='Enter'||event.key===' '){event.preventDefault();confirm();}
  else if((event.key==='Backspace'||event.key==='Delete')&&!pending.value&&props.modelValue.length){
    event.preventDefault();emit('update:modelValue',props.modelValue.slice(0,-1));
  }
}
</script>
<template>
  <div class="publish-tags-field">
    <label :for="inputId">标签</label>
    <div class="tag-input-shell">
      <span v-for="(tag,index) in modelValue" :key="index" class="topic-tag"><span>{{tag.startsWith('#')?tag:'#'+tag}}</span><button type="button" :aria-label="'删除标签：'+tag" @click="remove(tag)">×</button></span>
      <input :id="inputId" ref="input" v-model="pending" aria-label="话题标签" placeholder="输入标签后回车" @keydown="onKeydown" @compositionstart="composing=true" @compositionend="composing=false"/>
    </div>
  </div>
</template>
<style scoped>
.publish-tags-field{min-width:0}
.publish-tags-field>label{display:block;margin:0;color:#a5b4cb;font-size:var(--app-font-size-meta);line-height:18px}
.tag-input-shell{min-height:36px;display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:6px 8px;border-radius:12px;background:#20222edb;border:1px solid #235269;margin-top:6px;min-width:0}
.topic-tag{min-height:23px;padding:0 8px;display:inline-flex;align-items:center;gap:5px;border-radius:999px;color:#a5b4cb;background:#41385d66;border:1px solid #34516a;font-size:var(--app-font-size-caption);font-weight:900;max-width:100%;min-width:0;line-height:21px}
/* 普通标签保持原版高度，极长文字允许换行并给删除按钮保留位置。 */
.topic-tag>span{min-width:0;overflow-wrap:anywhere}
.topic-tag>button{width:15px;min-width:15px;height:15px;min-height:0;flex-shrink:0;padding:0;border:0;border-radius:50%;color:#a5b4cb;background:#ffffff0d;line-height:13px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:var(--app-font-size-caption)}
.tag-input-shell>input{flex:1;min-width:min(110px,100%);width:110px;max-width:100%;height:23px;min-height:0;padding:0;border:0;border-radius:0;outline:none;color:#a5b4cb;background:transparent;font-size:var(--app-font-size-caption);box-shadow:none}
.tag-input-shell:focus-within{border-color:#3b7d98}
.topic-tag>button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
</style>
