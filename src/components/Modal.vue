<script setup>
import {ref,inject,onMounted,onUnmounted,nextTick} from 'vue';
import I from './Icon.vue';
const props=defineProps({title:String,wide:Boolean,variant:String,backdropStyle:Object,maskClosable:{type:Boolean,default:true},closeDisabled:Boolean});
const emit=defineEmits(['close']);
const panel=ref();let previous;
const studio=inject('studio',null);
// 保存期间保留弹窗与返回结果，普通弹窗仍沿用背景与Escape关闭。
function requestClose(){if(!props.closeDisabled)emit('close');}
function keys(e){if([...document.querySelectorAll('.modal[role="dialog"]')].at(-1)!==panel.value)return;if(e.key==='Escape')requestClose();if(e.key==='Tab'){const items=[...panel.value.querySelectorAll('button,input,textarea,select,a,[tabindex="0"]')].filter(x=>!x.disabled&&x.offsetParent!==null);if(!items.length){e.preventDefault();return;}const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}
onMounted(async()=>{previous=document.activeElement;studio?.dismissTransientNotice();document.addEventListener('keydown',keys);await nextTick();panel.value.querySelector('input,textarea,select,button')?.focus();});onUnmounted(()=>{document.removeEventListener('keydown',keys);previous?.focus();});
</script>
<template><Teleport to="body"><div class="modal-backdrop" :class="variant&&variant+'-backdrop'" :style="backdropStyle" @mousedown.self="maskClosable&&requestClose()"><section ref="panel" class="modal" :class="[{wide},variant&&variant+'-modal']" role="dialog" aria-modal="true" :aria-label="title"><header><h2>{{title}}</h2><slot name="header-actions"/><button class="icon-button" :disabled="closeDisabled" aria-label="关闭弹窗" @click="requestClose"><I name="X"/></button></header><div class="modal-body"><slot/></div><footer v-if="$slots.footer"><slot name="footer"/></footer></section></div></Teleport></template>
