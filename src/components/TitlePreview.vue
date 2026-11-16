<script setup>
import {inject,ref,computed,watch} from 'vue';
import {call,mediaUrl} from '../api';
import MediaPreview from './MediaPreview.vue';
import TitleCanvas from './TitleCanvas.vue';
import {titleDesign} from '../../server/title-model.mjs';
const {draft:d,act,notify}=inject('studio');const mode=ref('edit'),size=ref({width:1080,height:1920}),time=ref(0),video=ref(),error=ref(''),timeline=ref(null),detecting=ref(false),removed=ref(false);
const source=computed(()=>d.value.edit.sourceId||d.value.video.assetId),asset=computed(()=>mode.value==='result'?d.value.edit.resultId:source.value),design=computed(()=>titleDesign(d.value.edit));
const visible=computed(()=>mode.value==='edit'&&d.value.edit.titleEnabled&&d.value.edit.titleDesign&&(!d.value.edit.cutSilence||timeline.value)&&!removed.value&&(design.value.displayMode==='always'||time.value<design.value.duration));
const cutSignature=()=>JSON.stringify({id:d.value.id,source:source.value,cut:d.value.edit.cutSilence,threshold:d.value.edit.silenceThreshold,minimum:d.value.edit.silenceMinimum,padding:d.value.edit.silencePadding});
watch(cutSignature,()=>{timeline.value=null;removed.value=false;});
async function detect(){detecting.value=true;const signature=cutSignature();try{const result=await act('同步剪气口预览',()=>call('analyzeSilence',{id:d.value.id}));if(result&&signature===cutSignature()){timeline.value=result;tick();}else if(result)notify('视频或剪气口设置已变化，请重新同步预览');}finally{detecting.value=false;}}
function tick(){
 if(!video.value)return;const speed=mode.value==='edit'?(Number(d.value.edit.speed)||1):1;video.value.playbackRate=speed;let t=video.value.currentTime;removed.value=false;
 if(mode.value==='edit'&&d.value.edit.cutSilence&&timeline.value){let kept=0,found=false;for(const part of timeline.value.keep){if(t>=part.start&&t<part.end){kept+=t-part.start;found=true;break;}if(t>=part.end)kept+=part.end-part.start;}if(!found&&!video.value.paused){const next=timeline.value.keep.find(part=>part.start>t);if(next)video.value.currentTime=next.start;}t=kept;removed.value=!found;}time.value=t/speed;
}
watch(()=>[d.value.id,source.value],async()=>{time.value=0;const id=d.value.id,src=source.value;try{const result=await call('subtitleSourceSize',{id});if(d.value.id===id&&source.value===src)size.value=result;}catch(e){error.value=e.message;}},{immediate:true});
watch(()=>d.value.id,()=>{mode.value='edit';});
function move(offset){d.value.edit.titleDesign={...design.value,...offset};}
</script>
<template><article class="card edit-preview title-preview"><h3>{{mode==='result'?'成片预览':'编辑预览'}}</h3><div class="segmented" role="group" aria-label="剪辑预览模式"><button :class="{active:mode==='edit'}" @click="mode='edit'">编辑预览</button><button :class="{active:mode==='result'}" :disabled="!d.edit.resultId" @click="mode='result'">成片预览</button></div><p class="hint">{{mode==='edit'?'拖动标题调整位置，播放检查显示时长':'播放已生成的剪辑结果'}}</p><button v-if="mode==='edit'&&d.edit.cutSilence" :disabled="detecting" @click="detect">{{detecting?'正在检测…':timeline?'重新同步剪气口预览':'同步剪气口预览'}}</button><p v-if="mode==='edit'&&d.edit.cutSilence&&!timeline" class="hint">先同步剪气口，标题按裁切及倍速后的时间显示。</p><div v-if="asset" class="title-video-shell"><div class="title-video-stage" :style="{aspectRatio:size.width+'/'+size.height}"><video ref="video" :key="asset" :src="mediaUrl(asset)" controls preload="metadata" @timeupdate="tick" @loadedmetadata="tick"/><TitleCanvas v-if="visible" :edit="d.edit" :width="size.width" :height="size.height" interactive @move="move" @error="error=$event"/></div></div><MediaPreview v-else title="暂无预览视频" description="选择视频源后编辑标题"/><p v-if="error" class="title-operation-error" role="alert">{{error}}</p></article></template>
