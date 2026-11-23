<script setup>
import {ref,computed,inject,watch} from 'vue';
import {call} from '../api';
import MediaPreview from './MediaPreview.vue';
const {draft,state,save,busy,workflowLocked,refresh}=inject('studio');
const report=ref(null),checking=ref(false),saving=ref(false),error=ref(''),checked=ref({}),notes=ref('');
let request=0;
const signature=computed(()=>JSON.stringify({id:draft.value.id,confirmed:draft.value.confirmed,sourceText:draft.value.sourceText,rewrite:draft.value.rewrite,finalText:draft.value.finalText,language:draft.value.language,voice:draft.value.voice,video:draft.value.video,edit:draft.value.edit,cover:draft.value.cover,publish:draft.value.publish,story:draft.value.story,referenceSelection:draft.value.referenceSelection,productSelection:draft.value.productSelection,product:draft.value.product,creativePreset:draft.value.creativePreset}));
const current=computed(()=>report.value?.draftId===draft.value.id?report.value:null);
const locked=computed(()=>!!busy.value||!!workflowLocked?.value||checking.value||saving.value||state.value.runs.some(r=>r.draftId===draft.value.id&&['running','queued','unknown'].includes(r.status)));
const statusNames={unchecked:'尚未复核',stale:'作品已变化，需重新复核','needs-changes':'人工复核：需要修改',approved:'人工复核：本版通过'};
const canApprove=computed(()=>current.value?.technicalPassed&&current.value.items.every(item=>checked.value[item.id]===true));
watch(signature,()=>{request++;report.value=null;checked.value={};notes.value='';error.value='';},{flush:'sync'});
async function check(){
 if(locked.value)return;checking.value=true;error.value='';report.value=null;
 try{await save();const token=++request,id=draft.value.id,before=signature.value,result=await call('getProductionReview',{id});if(token!==request||id!==draft.value.id||before!==signature.value)return;report.value=result;checked.value={...(result.currentReview?.checked||{})};notes.value=result.currentReview?.notes||'';}
 catch(e){error.value=e.message;}finally{checking.value=false;}
}
async function submit(status){
 if(locked.value||!current.value)return;const input=current.value,token=request,id=draft.value.id,before=signature.value;saving.value=true;error.value='';
 try{const result=await call('saveProductionReview',{id,fingerprint:input.fingerprint,historyVersion:input.historyVersion,status,checked:checked.value,notes:notes.value});if(token!==request||id!==draft.value.id||before!==signature.value)return;report.value=result;await refresh();}
 catch(e){error.value=e.message;}finally{saving.value=false;}
}
</script>
<template>
 <section class="card production-review" aria-label="成片质量复核">
  <div class="review-heading"><div><h3>成片质量复核</h3><p>先完整播放，再记录这一版的实际问题。技术检查与人工感官判断分别保存。</p></div><button :disabled="locked" @click="check">{{checking?'正在检查…':current?'重新检查当前作品':'检查当前作品'}}</button></div>
  <p v-if="error" class="review-error" role="alert">{{error}}</p>
  <p v-if="!current" class="review-hint">检查后显示当前视频、媒体版本和复核项目。修改文案、字幕、声音或画面后，请重新检查。</p>
  <template v-else>
   <p class="review-state" role="status">{{statusNames[current.status]||'尚未复核'}}</p>
   <div class="review-columns"><div class="review-player"><MediaPreview :id="current.videoId" title="还没有待交付视频"/><p class="review-hint">请开启声音完整播放；文件可解析不代表动作、声音或商品外观已通过。</p></div>
    <div class="review-form"><section><h4>自动技术检查</h4><ul class="review-checks"><li v-for="item in current.checks" :key="item.id"><strong>{{item.passed?'通过':'待处理'}}</strong><span>{{item.label}}</span></li></ul></section>
     <fieldset :disabled="locked||!current.videoId"><legend>人工审看 · 逐项确认</legend><label v-for="item in current.items" :key="item.id"><input v-model="checked[item.id]" type="checkbox"/><span>{{item.label}}</span></label></fieldset>
     <label class="review-notes">具体问题或复核说明<textarea v-model="notes" :disabled="locked" maxlength="4000" rows="3" placeholder="例如：接砂盒在第3秒变形，需要简化动作或更换模型。标记需修改时必须填写。"/></label>
     <div class="review-actions"><button :disabled="locked||!current.videoId||!notes.trim()" @click="submit('needs-changes')">保存为需修改</button><button class="primary" :disabled="locked||!canApprove" @click="submit('approved')">保存人工通过</button></div>
    </div></div>
   <details class="review-versions"><summary>本版媒体与历史记录（{{current.history.length}}）</summary><p class="review-hint">仅记录本机人工判断，不等于模型自动验收或平台审核。</p><ul><li v-for="item in current.media" :key="item.id"><strong>{{item.roles.join(' / ')}} · {{item.name}}</strong><code>{{item.sha256||item.error}}</code></li></ul><ol v-if="current.history.length"><li v-for="item in current.history" :key="item.id"><strong>{{statusNames[item.status]}} · {{new Date(item.reviewedAt).toLocaleString('zh-CN')}}</strong><p>{{item.notes||'无补充说明'}}</p><span v-if="item.fingerprint!==current.fingerprint">历史版本，当前作品不沿用此结果</span></li></ol></details>
  </template>
 </section>
</template>
<style scoped>
.production-review{margin-top:24px;min-width:0}.review-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.review-heading h3,.review-form h4{margin:0}.review-heading p,.review-hint{color:var(--muted);line-height:1.7;margin:8px 0 0}.review-heading button{flex-shrink:0;min-height:40px}.review-state{margin:20px 0;padding:12px 14px;border:1px solid var(--border,#41485c);border-radius:10px}.review-columns{display:grid;grid-template-columns:minmax(220px,.7fr) minmax(0,1fr);gap:24px}.review-player{min-width:0}.review-player :deep(.media-preview){min-height:220px;height:360px}.review-form{min-width:0;display:flex;flex-direction:column;gap:20px}.review-checks{list-style:none;padding:0;margin:12px 0 0;display:grid;gap:10px}.review-checks li{display:flex;gap:10px;line-height:1.6;overflow-wrap:anywhere}.review-checks strong{flex-shrink:0;color:var(--muted)}fieldset{min-width:0;border:1px solid var(--border,#41485c);border-radius:10px;padding:14px}legend{padding:0 6px}fieldset label{display:flex;align-items:flex-start;gap:10px;line-height:1.7;margin:10px 0}fieldset input{width:18px;height:18px;min-height:18px;flex-shrink:0;margin:4px 0 0;padding:0}.review-notes{display:grid;gap:10px}.review-notes textarea{width:100%;resize:vertical;min-height:90px}.review-actions{display:flex;flex-wrap:wrap;gap:12px}.review-actions button{min-height:42px}.review-error{color:var(--danger,#ffb1b1);line-height:1.6;margin-top:14px}.review-versions{margin-top:24px;line-height:1.7;overflow-wrap:anywhere}.review-versions summary{cursor:pointer}.review-versions ul,.review-versions ol{padding-left:22px}.review-versions li{margin:12px 0}.review-versions code{display:block;overflow-wrap:anywhere;white-space:normal;font-size:.85em;color:var(--muted)}.review-versions p{margin:4px 0}@media(max-width:1180px){.review-columns{grid-template-columns:minmax(0,1fr)}.review-player :deep(.media-preview){height:300px}.review-heading{flex-wrap:wrap}}
</style>
