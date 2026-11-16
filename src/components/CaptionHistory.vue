<script setup>
import {computed,inject,ref,watch} from 'vue';
import Modal from './Modal.vue';
import {call} from '../api';
const emit=defineEmits(['close']);
const {draft,state,save,refresh,notify,busy,workflowLocked}=inject('studio'),selectedId=ref(''),error=ref(''),saving=ref(false);
const entries=computed(()=>draft.value.artifacts?.captionHistory||[]),source=computed(()=>draft.value.edit.sourceId||draft.value.video.assetId||'');
const selected=computed(()=>entries.value.find(entry=>entry.id===selectedId.value));
const signature=d=>JSON.stringify({id:d.id,sourceId:d.edit.sourceId||d.video.assetId||'',captions:d.edit.captions,history:d.artifacts?.captionHistory||[]});
const name=id=>state.value.assets.find(a=>a.id===id)?.name||'视频已缺失或未记录';
watch(()=>[draft.value.id,source.value],()=>emit('close'));
async function restore(){
 if(saving.value||busy.value||workflowLocked.value||!selected.value||selected.value.sourceId!==source.value)return;
 const id=draft.value.id,historyId=selected.value.id;error.value='';saving.value=true;
 try{
  await save();if(draft.value.id!==id)throw Error('当前任务已变化，请重新打开字幕历史');
  const input=signature(draft.value);await call('restoreCaptionHistory',{id,historyId,signature:input});
  const unchanged=draft.value.id===id&&signature(draft.value)===input;await refresh();
  notify(unchanged?'字幕已恢复到当前视频，请核对后重新剪辑':'字幕已恢复到原任务；当前正在编辑的内容已保留',unchanged?'success':'info');emit('close');
 }catch(e){const message=String(e.message).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');error.value=/\b(?:EPERM|EACCES|EROFS)\b/.test(message)?'工作目录不可写，字幕未恢复。请解除只读或检查权限后重试，当前字幕与历史已保留。':message;}finally{saving.value=false;}
}
</script>
<template><Modal title="字幕历史" variant="caption-history" wide @close="!saving&&emit('close')"><p class="hint">换视频时会归档旧字幕。仅可恢复当前视频对应的历史，恢复前会保留当前字幕，恢复后需要重新剪辑。</p><p v-if="error" role="alert" class="history-error">{{error}}</p><div v-if="entries.length" class="caption-history-layout"><div class="caption-history-list"><button v-for="entry in entries" :key="entry.id" :class="{active:selected?.id===entry.id}" @click="selectedId=entry.id" :aria-pressed="selected?.id===entry.id"><strong>{{name(entry.sourceId)}}</strong><small>{{entry.rows.length}} 条 · {{new Date(entry.archivedAt).toLocaleString('zh-CN')}}</small><span>{{entry.sourceId===source?'当前视频':'其他视频，需先切回'}}</span></button></div><div class="caption-history-detail"><template v-if="selected"><p v-for="(row,index) in selected.rows" :key="index"><small>{{Number(row.start).toFixed(2)}}—{{Number(row.end).toFixed(2)}}s</small><span>{{row.text}}</span></p></template><p v-else class="hint">选择一份历史查看完整字幕与时间。</p></div></div><p v-else class="hint">暂无归档字幕。</p><template #footer><button :disabled="saving" @click="emit('close')">关闭</button><button class="primary" :disabled="saving||!!busy||workflowLocked||!selected||!source||selected.sourceId!==source" @click="restore">{{saving?'正在恢复…':'恢复所选字幕'}}</button></template></Modal></template>
<style>
.caption-history-layout{display:grid;grid-template-columns:minmax(220px,1fr) minmax(0,2fr);gap:16px;min-height:240px}.caption-history-list{display:flex;flex-direction:column;gap:10px;min-width:0}.caption-history-list button{display:flex;flex-direction:column;gap:6px;text-align:left;align-items:flex-start;white-space:normal;overflow-wrap:anywhere;padding:12px}.caption-history-list button.active{border-color:var(--primary);background:#49365e}.caption-history-list small{color:var(--muted)}.caption-history-detail{min-width:0;border:1px solid var(--border);border-radius:8px;padding:12px}.caption-history-detail p{margin:0 0 12px;line-height:1.7;display:flex;flex-direction:column;gap:4px;overflow-wrap:anywhere}.caption-history-detail small{color:var(--muted)}.history-error{color:#ffadad;line-height:1.6;margin-bottom:12px}@media(max-width:800px){.caption-history-layout{grid-template-columns:1fr}}
</style>
