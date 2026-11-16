<script setup>
import {ref,watch,onBeforeUnmount} from 'vue';
import {call} from '../api';
import {namecardSnapshot,namecardDesign} from '../../server/namecard-model.mjs';
import {prepareNamecard,drawNamecard} from '../namecard-render.mjs';
import {loadTitleFont} from '../title-render.mjs';
const props=defineProps({edit:Object,width:Number,height:Number,interactive:Boolean});
const emit=defineEmits(['move','error']);const canvas=ref(),bounds=ref(null);let version=0,drag=null;
async function paint(){const current=++version;try{const snapshot=namecardSnapshot(props.edit,props.width,props.height),fonts=await call('listSubtitleFonts'),ready=await prepareNamecard(snapshot,fonts,f=>loadTitleFont(call,f));if(current!==version||!canvas.value)return;bounds.value=drawNamecard(canvas.value,ready);emit('error','');}catch(error){if(current!==version)return;bounds.value=null;canvas.value?.getContext('2d').clearRect(0,0,props.width,props.height);emit('error',error.message.replace(/封面/g,'名片'));}}
watch(()=>[canvas.value,props.edit,props.width,props.height],paint,{deep:true,flush:'post'});
function point(event){const r=canvas.value.getBoundingClientRect();return {x:(event.clientX-r.x)/r.width*1080,y:(event.clientY-r.y)/r.height*1920};}
function down(event){if(!props.interactive||event.button!==0||!bounds.value)return;const b=bounds.value;drag={point:point(event),design:{offsetX:b.x/props.width*1080,offsetY:(props.height-b.y-b.height)/props.height*1920}};event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();}
function move(event){if(!drag)return;const p=point(event),b=bounds.value,sx=props.width/1080,sy=props.height/1920;emit('move',{offsetX:Math.round(Math.max(0,Math.min(900,(props.width-b.width)/sx,drag.design.offsetX+p.x-drag.point.x))),offsetY:Math.round(Math.max(0,Math.min(1600,(props.height-b.height)/sy,drag.design.offsetY-p.y+drag.point.y)))});}
function up(event){drag=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}
function key(event){const step={ArrowLeft:[-2,0],ArrowRight:[2,0],ArrowUp:[0,2],ArrowDown:[0,-2]}[event.key];if(!step)return;event.preventDefault();const s=namecardDesign(props.edit);emit('move',{offsetX:Math.min(900,Math.max(0,s.offsetX+step[0])),offsetY:Math.min(1600,Math.max(0,s.offsetY+step[1]))});}
watch(()=>props.interactive,()=>drag=null);onBeforeUnmount(()=>{version++;drag=null;});
</script>
<template><div class="namecard-canvas-wrap"><canvas ref="canvas" :width="width" :height="height" aria-label="个人名片图层"/><div v-if="interactive&&bounds" class="namecard-drag-handle" role="button" tabindex="0" aria-label="移动名片，方向键微调" :style="{left:bounds.x/width*100+'%',top:bounds.y/height*100+'%',width:bounds.width/width*100+'%',height:bounds.height/height*100+'%'}" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @lostpointercapture="drag=null" @keydown="key"/></div></template>
