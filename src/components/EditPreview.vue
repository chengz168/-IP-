<script setup>
import {computed,inject,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import I from './Icon.vue';
import MediaPreview from './MediaPreview.vue';
import TitleCanvas from './TitleCanvas.vue';
import NamecardCanvas from './NamecardCanvas.vue';
import EditSubtitleOverlay from './EditSubtitleOverlay.vue';
import {call,mediaUrl} from '../api';
import {operationErrorMessage} from '../operation-error.mjs';
import {editSource,editPreviewResult} from '../edit-preview-model.mjs';
import {titleDesign} from '../../server/title-model.mjs';
import {namecardDesign} from '../../server/namecard-model.mjs';

const {state,draft:d,notify,workflowLocked}=inject('studio');
const mode=ref('edit'),expanded=ref(false),pending=ref(''),frame=ref(null),loading=ref(false),frameError=ref(''),titleError=ref(''),cardError=ref(''),subtitleError=ref(''),surface=ref(),expandButton=ref(),video=ref(),surfaceSize=ref({width:0,height:0});
const source=computed(()=>editSource(d.value)),result=computed(()=>editPreviewResult(state.value,d.value)),showResult=computed(()=>mode.value==='result'&&!!result.value.asset),desktop=window.studio;
const hint=computed(()=>showResult.value?(result.value.dirty?'当前成片不是最新配置，重新剪辑后生效':result.value.asset.name):loading.value?'正在基于视频首帧准备编辑预览':'基于视频首帧展示样式，实际效果以剪辑结果为准');
const overlayStyle=computed(()=>{
  const {width:w,height:h}=surfaceSize.value,f=frame.value;if(!f||!w||!h)return {width:'0px',height:'0px'};
  const scale=Math.min(w/f.width,h/f.height),width=f.width*scale,height=f.height*scale;
  return {width:width+'px',height:height+'px',left:(w-width)/2+'px',top:(h-height)/2+'px'};
});
let request=0,alive=true,observer;
async function readFrame(){
  const version=++request,id=source.value,taskId=d.value.id;frame.value=null;frameError.value='';titleError.value='';
  if(!id){loading.value=false;return;}loading.value=true;
  try{const value=await call('previewEditFrame',{assetId:id});if(alive&&version===request&&d.value.id===taskId&&source.value===id&&value.assetId===id)frame.value=value;}
  catch(error){if(alive&&version===request)frameError.value=operationErrorMessage(error);}
  finally{if(alive&&version===request)loading.value=false;}
}
// 分别比较任务与素材ID，自动保存替换对象时不重建首帧和拖动节点。
watch([()=>d.value.id,source],()=>{mode.value='edit';expanded.value=false;readFrame();},{immediate:true});
watch(()=>d.value.edit.resultId,(id,before)=>{if(id&&id!==before)mode.value='result';},{immediate:true});
watch(showResult,value=>{if(!value)expanded.value=false;});
watch(workflowLocked,value=>{if(value)expanded.value=false;});
watch(surface,(element,before)=>{if(before)observer?.unobserve(before);if(element)observer?.observe(element);resize();},{flush:'post'});
function resize(){const r=surface.value?.getBoundingClientRect();if(r)surfaceSize.value={width:r.width,height:r.height};}
function move(offset){d.value.edit.titleDesign={...titleDesign(d.value.edit),...offset};}
function moveCard(offset){d.value.edit.cardDesign={...namecardDesign(d.value.edit),...offset};}
async function toggleExpanded(){expanded.value=!expanded.value;await nextTick();resize();expandButton.value?.focus();}
function key(event){if(event.key==='Escape'&&expanded.value){event.preventDefault();toggleExpanded();}}
async function fileAction(action){
  const asset=result.value.asset;if(!asset||pending.value)return;pending.value=action;
  try{
    if(action==='open'){if(desktop)await desktop.revealAsset(asset.id);}
    else if(desktop){const value=await desktop.exportAsset(asset.id,{purpose:'video'});if(!value.canceled)notify('视频导出成功：'+value.name,'success');}
    else{const link=document.createElement('a');link.href=mediaUrl(asset.id);link.download=asset.name;link.click();}
  }catch(error){notify((action==='open'?'打开文件夹失败：':'导出视频失败：')+operationErrorMessage(error),'error');}
  finally{pending.value='';}
}
onMounted(()=>{observer=new ResizeObserver(resize);if(surface.value)observer.observe(surface.value);resize();window.addEventListener('keydown',key);});
onBeforeUnmount(()=>{alive=false;request++;observer?.disconnect();window.removeEventListener('keydown',key);});
</script>
<template>
  <article class="card edit-preview shared-edit-preview">
    <header class="edit-preview-heading">
      <div class="edit-preview-description"><h3>{{showResult?'成片预览':'编辑预览'}}</h3><p :title="hint">{{hint}}</p></div>
      <div v-if="result.asset" class="edit-preview-actions">
        <span v-if="result.dirty" class="edit-preview-dirty">成片未更新</span>
        <div class="edit-preview-modes" role="group" aria-label="剪辑预览模式"><button :aria-pressed="!showResult" :class="{active:!showResult}" @click="mode='edit'">编辑预览</button><button :aria-pressed="showResult" :class="{active:showResult}" @click="mode='result'">成片预览</button></div>
        <template v-if="showResult"><button class="edit-preview-open" :disabled="!!pending||!desktop" :title="desktop?'打开成片所在文件夹':'请在桌面客户端打开文件夹'" @click="fileAction('open')">打开</button><button class="edit-preview-export" :disabled="!!pending" @click="fileAction('export')">{{pending==='export'?'导出中':'导出'}}</button></template>
      </div>
    </header>
    <div class="edit-preview-canvas">
      <Teleport to="body" :disabled="!expanded">
        <div v-if="showResult" ref="surface" class="edit-media-surface edit-rendered-surface" :class="{expanded}">
          <video ref="video" :key="result.asset.id" :src="mediaUrl(result.asset.id)" controls controlslist="nodownload noremoteplayback" disablepictureinpicture muted preload="metadata" aria-label="剪辑成片视频" @error="notify('成片文件无法播放，请检查文件是否存在或重新剪辑','error')"/>
          <button ref="expandButton" class="edit-preview-expand" :title="expanded?'退出窗口内容区预览':'窗口内容区预览'" :aria-label="expanded?'退出窗口内容区预览':'窗口内容区预览'" @click="toggleExpanded"><I :name="expanded?'FullscreenExitOutlined':'FullscreenOutlined'" :size="18"/></button>
        </div>
      </Teleport>
      <div v-if="!showResult&&frame" ref="surface" class="edit-media-surface edit-first-frame">
        <img :src="frame.dataUrl" alt="编辑预览首帧" @load="resize"/>
        <div class="edit-preview-overlays" :style="overlayStyle"><EditSubtitleOverlay v-if="d.edit.subtitlesEnabled" :edit="d.edit" :width="parseFloat(overlayStyle.width)" :height="parseFloat(overlayStyle.height)" :source-width="frame.width" :source-height="frame.height" @error="subtitleError=$event"/><TitleCanvas v-if="d.edit.titleEnabled&&d.edit.titleDesign" :edit="d.edit" :width="frame.width" :height="frame.height" interactive @move="move" @error="titleError=$event"/><NamecardCanvas v-if="d.edit.cardEnabled" :edit="d.edit" :width="frame.width" :height="frame.height" interactive @move="moveCard" @error="cardError=$event"/></div>
      </div>
      <div v-else-if="!showResult&&(loading||frameError)" class="edit-preview-feedback"><I :name="loading?'LoaderCircle':'Video'" :class="{spin:loading}" :size="36"/><p :role="frameError?'alert':undefined">{{loading?'正在读取视频首帧…':frameError}}</p><button v-if="frameError" @click="readFrame">重新读取预览</button></div>
      <MediaPreview v-else-if="!showResult" title="暂无预览视频" description="选择视频源后可预览编辑样式"/>
    </div>
    <p v-if="titleError&&!showResult" class="title-operation-error" role="alert">{{titleError}}</p>
    <p v-if="cardError&&d.edit.cardEnabled&&!showResult" class="title-operation-error" role="alert">{{cardError}}</p>
    <p v-if="subtitleError&&d.edit.subtitlesEnabled&&!showResult" class="title-operation-error" role="alert">{{subtitleError}}</p>
  </article>
</template>
