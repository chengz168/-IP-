<script setup>
import {computed,inject,ref,watch} from 'vue';
import I from './Icon.vue';
import MediaPreview from './MediaPreview.vue';
import {mediaUrl} from '../api';
import {operationErrorMessage} from '../operation-error.mjs';
const props=defineProps({id:String});
const {state,notify}=inject('studio');
const pending=ref(''),desktop=window.studio;
const asset=computed(()=>state.value.assets.find(item=>item.id===props.id));
const video=ref(null),currentTime=ref(0),mediaDuration=ref(null),mediaFailed=ref(false);
const totalDuration=computed(()=>{
  if(mediaDuration.value!==null)return mediaDuration.value;
  const value=Number(asset.value?.duration);
  return Number.isFinite(value)&&value>0?value:null;
});
watch(()=>props.id,()=>{currentTime.value=0;mediaDuration.value=null;mediaFailed.value=false;},{flush:'sync'});
function timeLabel(seconds){
  const value=Math.max(0,Math.floor(seconds)),hours=Math.floor(value/3600),minutes=Math.floor(value%3600/60),secondsPart=String(value%60).padStart(2,'0');
  return hours?hours+':'+String(minutes).padStart(2,'0')+':'+secondsPart:minutes+':'+secondsPart;
}
function syncTime(event){
  // 切换视频后忽略旧节点的事件，优先使用实际媒体元数据。
  if(event.currentTarget!==video.value||event.currentTarget.dataset.assetId!==props.id)return;
  const player=event.currentTarget;
  currentTime.value=Number.isFinite(player.currentTime)?Math.max(0,player.currentTime):0;
  mediaDuration.value=Number.isFinite(player.duration)&&player.duration>0?player.duration:null;
  mediaFailed.value=!!player.error;
}
async function open(){
  if(!props.id||pending.value||!desktop)return;
  const id=props.id;pending.value='open';
  try{await desktop.revealAsset(id);}catch(error){notify('打开文件夹失败：'+operationErrorMessage(error),'error');}finally{pending.value='';}
}
async function exportVideo(){
  if(!props.id||pending.value)return;
  const id=props.id,name=asset.value?.name||'视频.mp4';pending.value='export';
  try{
    if(desktop){const result=await desktop.exportAsset(id,{purpose:'video'});if(!result.canceled)notify('视频导出成功：'+result.name,'success');}
    else{const link=document.createElement('a');link.href=mediaUrl(id);link.download=name;link.click();}
  }catch(error){notify('导出视频失败：'+operationErrorMessage(error),'error');}finally{pending.value='';}
}
</script>
<template>
  <article class="card video-result">
    <header class="video-result-heading">
      <h3>视频预览</h3>
      <div v-if="id" class="video-result-actions" :aria-busy="!!pending">
        <button class="video-result-open" :disabled="!!pending||!desktop" :title="desktop?'打开视频所在文件夹':'请在桌面客户端打开文件夹'" @click="open"><I name="FolderOpenOutlined" :size="14"/>打开</button>
        <button class="video-result-export" :disabled="!!pending" :title="pending==='export'?'正在导出视频':'导出视频'" @click="exportVideo"><I :name="pending==='export'?'LoaderCircle':'ExportOutlined'" :class="{spin:pending==='export'}" :size="14"/>导出</button>
      </div>
    </header>
    <div v-if="id" class="video-result-content">
      <video ref="video" :key="id" :data-asset-id="id" :src="mediaUrl(id)" controls preload="metadata" aria-label="视频预览" @loadedmetadata="syncTime" @durationchange="syncTime" @timeupdate="syncTime" @seeked="syncTime" @ended="syncTime" @error="syncTime"/>
      <div class="video-result-time"><span>播放时长</span><span aria-label="视频播放时间">{{timeLabel(currentTime)}} / {{totalDuration!==null?timeLabel(totalDuration):mediaFailed?'无法读取时长':'正在读取时长…'}}</span></div>
      <p v-if="asset" class="video-result-name" :title="asset.name">{{asset.name}}</p>
    </div>
    <MediaPreview v-else empty-icon="User" title="暂无预览视频" description="生成视频后将在此处显示预览"/>
  </article>
</template>
