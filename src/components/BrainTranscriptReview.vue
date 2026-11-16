<script setup>
import {computed,inject,onUnmounted,ref} from 'vue';
import Modal from './Modal.vue';
import {call,mediaUrl} from '../api';
const props=defineProps({profile:{type:Object,required:true}}),emit=defineEmits(['close','saved']);
const {draft:d,busy,act,notify}=inject('studio'),source=props.profile.sources.find(item=>item.kind==='local-video'),original=source.media.transcription,baseRevision=props.profile.revision;
// 只编辑文字副本；原始时间边界与ASR文本始终单独保留。
const rows=ref((source.media.reviewedTranscription||original).segments.map(item=>({...item}))),error=ref(''),player=ref(),playEnd=ref(null);
const count=computed(()=>rows.value.reduce((total,row)=>total+row.text.length,0));
function pause(){player.value?.pause();playEnd.value=null;}
async function play(index){error.value='';try{const video=player.value;if(!video)throw Error('原视频尚未加载');if(video.readyState<1)throw Error('原视频仍在加载，请稍候再播放');video.currentTime=rows.value[index].start;playEnd.value=rows.value[index].end;await video.play();}catch(e){pause();error.value=e.message;}}
function tick(){if(playEnd.value!==null&&player.value?.currentTime>=playEnd.value)pause();}
function close(){if(busy.value)return;pause();emit('close');}
async function save(){
 error.value='';const empty=rows.value.findIndex(row=>!row.text.trim());if(empty>=0){error.value='第'+(empty+1)+'句转写不能为空';return;}if(count.value<20||count.value>30000){error.value='校对转写需为20至30000字';return;}pause();
 const result=await act('按校对转写重新分析',async()=>{try{return await call('brainReview',{id:d.value.id,brainId:props.profile.id,revision:baseRevision,segments:rows.value});}catch(e){error.value=e.message;throw e;}});
 if(result?.stale){error.value='档案、任务或原视频已变化，结果保留在执行记录中，请重新打开校对';return;}
 if(result){notify('校对文字和新分析已保存，原始识别保留，旧选题已清除','success');emit('saved');}
}
onUnmounted(pause);
</script>
<template>
 <Modal title="校对学习转写" variant="brain-review" wide @close="close">
  <div class="brain-analysis-heading"><strong>{{profile.name}}</strong><span>{{count}} 字 · {{rows.length}} 句</span></div>
  <p class="hint brain-review-help">对照原视频修正识别文字。原始识别会保留，时间范围沿用原分句；保存后重新分析文字并清除旧选题，不重新识别音轨。</p>
  <video ref="player" class="brain-review-player" :src="mediaUrl(source.assetId)" controls preload="metadata" aria-label="校对原视频" @timeupdate="tick" @error="error='原视频无法播放，请检查素材文件'"/>
  <div class="brain-review-rows"><section v-for="(row,index) in rows" :key="index" class="brain-review-row">
   <div><label :for="'brain-review-'+index">第{{index+1}}句 · {{row.start.toFixed(2)}}–{{row.end.toFixed(2)}} 秒</label><button :disabled="!!busy" :aria-label="'播放第'+(index+1)+'句'" @click="play(index)">播放本句</button></div>
   <textarea :id="'brain-review-'+index" v-model="row.text" :disabled="!!busy" :aria-label="'第'+(index+1)+'句转写'" rows="2" maxlength="30000"/>
   <small v-if="row.text!==original.segments[index].text">原识别：{{original.segments[index].text}}</small>
  </section></div>
  <p v-if="busy" class="hint" role="status">正在重新分析，需结束或停止处理后关闭。</p><p v-if="error" class="brain-error" role="alert">{{error}}</p>
  <template #footer><button :disabled="!!busy" @click="close">取消</button><button class="primary" :disabled="!!busy" @click="save">保存校对并重新分析</button></template>
 </Modal>
</template>
