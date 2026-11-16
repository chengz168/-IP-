<script setup>
import {computed, inject, ref, nextTick, onMounted, onUnmounted} from 'vue';
import Modal from './Modal.vue';
import I from './Icon.vue';
import SubtitleProofread from './SubtitleProofread.vue';
import CaptionHistory from './CaptionHistory.vue';
import {call} from '../api';
import {openCaptionSession,saveCaptionSession} from '../caption-edit-session.mjs';
import {insertCaption,deleteCaption,changeCaptionStart,changeCaptionEnd,realignCaptionText,captionAsrSnapshot} from '../caption-edit-rules.mjs';

const props=defineProps({session:Object,auxiliaryTools:Boolean});
const emit = defineEmits(['close', 'import']);
const {draft, state, busy, save, notify, act} = inject('studio');
const localSession=ref(openCaptionSession(props.session,draft.value));
const session=computed(()=>props.session||localSession.value);
const saving = ref(false);
const proofreadOpen=ref(false);
const historyOpen=ref(false);
const showAuxiliary=ref(props.auxiliaryTools&&draft.value.edit.subtitleMode==='template'),auxiliaryError=ref('');
const auxiliaryFor=row=>row.auxiliary?.sourceText===row.text?row.auxiliary:{};
function setAuxiliary(row,key,value){row.auxiliary={...auxiliaryFor(row),sourceText:row.text,...(key==='keywords'?{keywordsInput:value}:{}),[key]:key==='keywords'?[...new Set(value.split(/[,，、]/).map(word=>word.trim()).filter(Boolean))]:value};auxiliaryError.value='';}
const signature=()=>JSON.stringify({id:draft.value.id,sourceId:draft.value.edit.sourceId||draft.value.video.assetId,captions:draft.value.edit.captions,language:draft.value.edit.subtitleLanguage||'英语'});
async function generateAuxiliary(kind){
  if(!await persist())return;
  auxiliaryError.value='';const result=await act(kind==='translation'?'生成字幕译文':'提取字幕关键词',()=>call('subtitleAuxiliary',{id:draft.value.id,kind}));
  if(!result)return;
  if(signature()!==result.signature){auxiliaryError.value='字幕、视频或任务已变化，本次结果保留在执行记录中，未覆盖当前内容。';return;}
  draft.value.edit.captions=result.rows;showAuxiliary.value=true;
  try{await save();notify(kind==='translation'?'字幕译文已生成，请人工核对':'关键词已提取，请人工核对','success');}catch(error){auxiliaryError.value='辅助文本保存失败，当前编辑内容已保留：'+error.message;}
  resync();
}
const rows = computed(() => session.value.rows);
const duration = computed(() => Number(state.value.assets.find(asset => asset.id === (draft.value.edit.sourceId || draft.value.video.assetId))?.duration));
const focusSnapshot=ref(null),table=ref(null);
const backdropStyle=ref({});let containerObserver;
function measureContainer(){
 if(props.auxiliaryTools)return;
 const container=document.querySelector('.stage-4');if(!container)return;
 const rect=container.getBoundingClientRect();
 backdropStyle.value={inset:'auto',left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px',padding:'0 12px',borderRadius:'24px',background:'color-mix(in srgb, var(--bg, #1b1d29) 66%, transparent)',backdropFilter:'blur(8px)','--caption-width':Math.max(520,Math.min(980,Math.round(rect.width-24)))+'px','--caption-max-width':'calc(100% - 24px)','--caption-height':'100%'};
}
function focus(row,field){focusSnapshot.value={row,field,value:row[field]};}
const timeInput=ref(null);
function timeValue(row,field){return timeInput.value?.row===row&&timeInput.value.field===field?timeInput.value.text:Number(row[field]).toFixed(2);}
function timeFocus(row,field,event){focus(row,field);timeInput.value={row,field,text:event.target.value};}
function timeBlur(row,field,event){timeInput.value=null;event.target.value=Number(row[field]).toFixed(2);}
function startChange(index,event){const row=rows.value[index];timeInput.value={row,field:'start',text:event.target.value};if(event.target.value==='')return;changeCaptionStart(rows.value,index,event.target.value);}
function endChange(index,event){const row=rows.value[index],snapshot=focusSnapshot.value;timeInput.value={row,field:'end',text:event.target.value};if(event.target.value==='')return;changeCaptionEnd(rows.value,index,event.target.value,snapshot?.row===row&&snapshot.field==='end'?snapshot.value:row.end);focusSnapshot.value={row,field:'end',value:row.end};}
function resizeText(event){const element=event.target||event;element.style.height='auto';element.style.height=Math.min(4*Number.parseFloat(getComputedStyle(element).lineHeight)+10,element.scrollHeight)+'px';}
function textBlur(row,index){const snapshot=focusSnapshot.value;focusSnapshot.value=null;if(!snapshot||snapshot.value!==row.text)realignCaptionText(rows.value,index,captionAsrSnapshot(state.value,draft.value));}
onMounted(()=>{for(const element of table.value?.querySelectorAll('.caption-text')||[])resizeText(element);measureContainer();window.addEventListener('resize',measureContainer);const container=document.querySelector('.stage-4');if(container&&!props.auxiliaryTools){containerObserver=new ResizeObserver(measureContainer);containerObserver.observe(container);}});
onUnmounted(()=>{containerObserver?.disconnect();window.removeEventListener('resize',measureContainer);});
function insert(index){if(!saving.value){insertCaption(rows.value,index);focusSnapshot.value=null;}}
function remove(index){if(!saving.value){deleteCaption(rows.value,index);focusSnapshot.value=null;}}
function close(){if(!saving.value)emit('close');}
function resync(){const next=openCaptionSession(null,draft.value);session.value.signature=next.signature;session.value.rows=next.rows;}
async function auxiliaryClosed(kind){if(kind==='proofread')proofreadOpen.value=false;else historyOpen.value=false;resync();await nextTick();for(const element of table.value?.querySelectorAll('.caption-text')||[])resizeText(element);}
async function openAuxiliary(kind){if(!await persist())return;if(kind==='proofread')proofreadOpen.value=true;else historyOpen.value=true;}

function append() {
  if (rows.value.length)insert(rows.value.length-1);
  else rows.value.push({start:0, end:Math.min(3, duration.value || 3), text:''});
}
async function persist() {
  if(saving.value||busy.value)return false;
  const invalid = rows.value.findIndex(row => !Number.isFinite(row.start) || !Number.isFinite(row.end) || row.start < 0 || row.end <= row.start);
  if (invalid >= 0){notify('第 '+(invalid + 1)+' 条字幕时间无效，结束时间必须大于开始时间', 'error');return false;}
  const badKeywords=rows.value.findIndex(row=>auxiliaryFor(row).keywords?.some(word=>!row.text.includes(word)));
  if(badKeywords>=0){auxiliaryError.value='第 '+(badKeywords+1)+' 条关键词必须逐字出现在原文中，请修改后保存。';return false;}
  saving.value = true;
  try {await saveCaptionSession({session:session.value,draft,save});return true;}
  catch (error) {auxiliaryError.value='字幕保存失败：'+error.message;notify(auxiliaryError.value, 'error');return false;}
  finally {saving.value = false;}
}
async function confirm(){if(await persist()){notify('字幕已更新，剪辑时将使用新的字幕内容','success');emit('close');}}
</script>

<template>
  <Modal title="编辑字幕" variant="caption" wide :backdrop-style="backdropStyle" @close="close">
    <template v-if="auxiliaryTools"><div v-if="draft.artifacts?.captionHistory?.length" class="caption-auxiliary-toolbar"><button :disabled="saving||!!busy" @click="openAuxiliary('history')">字幕历史</button><span>先保存当前编辑，再查看或恢复旧字幕</span></div>
    <div class="caption-auxiliary-toolbar"><button :disabled="saving||!!busy||!rows.length" @click="openAuxiliary('proofread')">按文案校对</button><span>先保存当前编辑，再回听并逐条选择建议</span></div>
    <div class="caption-auxiliary-toolbar"><button :aria-expanded="showAuxiliary" @click="showAuxiliary=!showAuxiliary">译文与关键词</button><template v-if="showAuxiliary"><button :disabled="saving||!!busy||!rows.length" @click="generateAuxiliary('translation')">生成双语译文</button><button :disabled="saving||!!busy||!rows.length" @click="generateAuxiliary('keywords')">提取关键词</button><span>使用已配置的本地文本模型，可手工填写</span></template></div></template>
    <p v-if="auxiliaryError" class="caption-auxiliary-error" role="alert">{{auxiliaryError}}</p>
    <div ref="table" class="caption-list">
      <table class="caption-table">
        <colgroup><col class="caption-sequence"/><col/><col class="caption-time"/><col class="caption-time"/><col class="caption-duration"/><col class="caption-actions"/></colgroup>
        <thead><tr><th>序号</th><th>字幕内容</th><th>开始时间(s)</th><th>结束时间(s)</th><th>时长</th><th>操作</th></tr></thead>
        <tbody><tr v-for="(row,index) in rows" :key="index">
          <td>{{index + 1}}</td>
          <td><textarea v-model="row.text" :disabled="saving" class="caption-text" aria-label="字幕内容" placeholder="请输入字幕文本" rows="1" @focus="focus(row,'text')" @input="resizeText" @blur="textBlur(row,index)"/><div v-if="showAuxiliary" class="caption-auxiliary-fields"><label>英语译文<textarea :value="auxiliaryFor(row).translation||''" :aria-label="'第'+(index+1)+'条字幕译文'" rows="2" placeholder="双语模板使用此译文" @input="setAuxiliary(row,'translation',$event.target.value)"></textarea></label><label>关键词<input :value="auxiliaryFor(row).keywordsInput??auxiliaryFor(row).keywords?.join('，')??''" :aria-label="'第'+(index+1)+'条字幕关键词'" placeholder="用逗号分隔，必须出现在原文中" @input="setAuxiliary(row,'keywords',$event.target.value)"/></label></div></td>
          <td><input :value="timeValue(row,'start')" :disabled="saving" aria-label="字幕开始时间" type="number" min="0" step="0.1" @focus="timeFocus(row,'start',$event)" @blur="timeBlur(row,'start',$event)" @input="startChange(index,$event)"/></td>
          <td><input :value="timeValue(row,'end')" :disabled="saving" aria-label="字幕结束时间" type="number" min="0" step="0.1" @focus="timeFocus(row,'end',$event)" @blur="timeBlur(row,'end',$event)" @input="endChange(index,$event)"/></td>
          <td>{{Number.isFinite(row.end - row.start) ? (row.end - row.start).toFixed(2) : '—'}}s</td>
          <td><div class="caption-actions-row"><button :disabled="saving" title="在当前行后插入字幕" @click="insert(index)">插入</button><button class="danger" :disabled="saving||rows.length<=1" aria-label="删除字幕" @click="remove(index)">删除</button></div></td>
        </tr></tbody>
      </table>
      <div v-if="!rows.length" class="empty-state"><I name="FileText" :size="40"/><p>导入SRT、调用识别服务或手动添加字幕。</p></div>
    </div>
    <template #footer><div v-if="auxiliaryTools" class="caption-footer-tools"><span>{{rows.length}} 条字幕</span><button :disabled="saving" @click="emit('import')">导入 SRT</button><button :disabled="saving" @click="append"><I name="Plus" :size="14"/>添加字幕</button></div><button :disabled="saving" @click="close">取消</button><button class="primary" :disabled="saving||!!busy" @click="confirm">确定</button></template>
  </Modal>
  <SubtitleProofread v-if="proofreadOpen" @close="auxiliaryClosed('proofread')"/>
  <CaptionHistory v-if="historyOpen" @close="auxiliaryClosed('history')"/>
</template>
<style scoped>
.caption-auxiliary-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:0 0 12px;flex-shrink:0}.caption-auxiliary-toolbar>span{font-size:var(--app-font-size-meta);color:var(--muted);line-height:22px}.caption-auxiliary-toolbar>button{min-height:32px;padding:4px 10px}.caption-auxiliary-error{margin:0 0 12px;color:#ffb4b4;font-size:var(--app-font-size-caption);line-height:1.6;flex-shrink:0}
.caption-auxiliary-fields{display:grid;gap:8px;margin-top:10px;min-width:0}.caption-auxiliary-fields label{margin:0;font-size:var(--app-font-size-meta);line-height:20px;color:#545969}.caption-auxiliary-fields input,.caption-auxiliary-fields textarea{margin-top:4px;min-height:32px;height:auto;font-size:var(--app-font-size-caption);line-height:1.6;padding:5px 8px;background:#484c55;color:#fff;border:1px solid #91949c}.caption-auxiliary-fields textarea{resize:vertical}
</style>
