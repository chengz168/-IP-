<script setup>
import {computed,ref,watch,onBeforeUnmount} from 'vue';
import {call} from '../api';
import {editSubtitlePreview} from '../edit-subtitle-preview.mjs';
import {prepareCoverFonts} from '../cover-fonts.mjs';
import {loadTitleFont} from '../title-render.mjs';
const props=defineProps({edit:Object,width:Number,height:Number,sourceWidth:Number,sourceHeight:Number}),emit=defineEmits(['error']),config=ref(null);let serial=0;
watch(()=>[props.edit,props.sourceHeight],async()=>{const current=++serial;config.value=null;emit('error','');try{const c=editSubtitlePreview(props.edit,{width:props.sourceWidth,height:props.sourceHeight}),fonts=await call('listSubtitleFonts');if(props.edit.subtitleMode==='template'){const font=fonts.find(f=>f.family===c.fontFamily&&f.source==='local')||fonts.find(f=>f.family===c.fontFamily);if(font)c.fontId=font.id;}const prepared=await prepareCoverFonts({layers:[{style:c}]},fonts,f=>loadTitleFont(call,f));if(current!==serial)return;config.value=prepared.layers[0].style;emit('error','');}catch(error){if(current!==serial)return;config.value=null;emit('error',error.message.replace(/封面/g,'字幕'));}},{deep:true,immediate:true});
onBeforeUnmount(()=>serial++);
const alpha=(color,opacity)=>/^#[a-f\d]{6}$/i.test(color)?color+Math.round(Math.min(1,Math.max(0,opacity))*255).toString(16).padStart(2,'0'):color;
const style=computed(()=>{const c=config.value;if(!c)return {};const sx=props.width/1080,sy=props.height/1920;return {left:Math.min(96,Math.max(4,(c.positionX||540)/1080*100))+'%',top:Math.min(96,Math.max(4,(c.positionY||1500)/1920*100))+'%',color:c.color,opacity:c.opacity??1,fontFamily:c.renderFamily||c.fontFamily,fontSize:Math.max(6,(c.fontSize||48)*sy)+'px',fontWeight:c.fontStyles?.includes('bold')?900:700,fontStyle:c.fontStyles?.includes('italic')?'italic':'normal',textDecoration:c.fontStyles?.includes('underline')?'underline':undefined,letterSpacing:(c.letterSpacing||0)*sx+'px',lineHeight:c.lineHeight||1.16,background:c.backgroundType==='none'?'transparent':alpha(c.backgroundColor||'#000000',c.backgroundOpacity??.5),WebkitTextStroke:c.enableStroke&&c.strokeWidth?Math.max(.5,c.strokeWidth*sx)+'px '+c.strokeColor:'0 transparent',textShadow:c.enableShadow===false?'none':`0 ${Math.max(.5,(c.shadowDistance||3)*sx)}px ${Math.max(1,16*sx)}px ${alpha(c.shadowColor||'#000000',c.shadowOpacity??.45)}`};});
const highlight=computed(()=>{const s=config.value?.highlightStyle||{};return {color:s.color||'#FFD700',fontWeight:s.bold?900:undefined,textDecoration:s.underline?'underline':undefined};});
</script>
<template><div v-if="config" class="shared-subtitle-overlay" :data-template-id="config.templateId||''" :style="style" aria-label="字幕样式示意预览">这是一条<span v-if="config.highlight" :style="highlight">字幕样式</span>预览</div></template>
