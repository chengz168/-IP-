<script setup>
import {computed,inject,onBeforeUnmount,ref,watch} from 'vue';
import I from './Icon.vue';
import AssetPicker from './AssetPicker.vue';
import {call} from '../api';
import {runExtractAction} from '../extract-action.mjs';
import {extractionBatchActive,extractionBatchUnsettled,extractionItemMessage,extractionProgress,extractionStatusLabel,previewExtractionLinks} from '../extract-batch-ui.mjs';
const emit=defineEmits(['batch-visible']);
const {draft:d,state,busy,workflowLocked,save,refresh,act,notify}=inject('studio');
const mode=ref('single'),batchInput=ref(''),selectedBatchId=ref(''),error=ref(''),pending=ref(''),pickerOpen=ref(false),liveBatch=ref(null),terminationNotes=ref({}),terminationChecks=ref({});
const batches=computed(()=>(state.value?.extractionBatches||[]).filter(batch=>batch.draftId===d.value.id));
const batch=computed(()=>{
 const id=selectedBatchId.value||batches.value[0]?.id;
 const saved=batches.value.find(item=>item.id===id);
 return liveBatch.value?.id===id?liveBatch.value:saved||null;
});
const blockingBatch=computed(()=>batches.value.find(extractionBatchUnsettled)||(extractionBatchUnsettled(batch.value)?batch.value:null));
const batchRunning=computed(()=>extractionBatchActive(batch.value));
const locked=computed(()=>!!busy.value||!!workflowLocked.value||!!pending.value);
const inputPreview=computed(()=>previewExtractionLinks(batchInput.value));
const singleInput=computed(()=>previewExtractionLinks(d.value.sourceUrl));
const singleReady=computed(()=>!locked.value&&!blockingBatch.value&&singleInput.value.total===1&&singleInput.value.unique===1);
const batchReady=computed(()=>!locked.value&&!blockingBatch.value&&inputPreview.value.unique>0&&inputPreview.value.total<=50);
const counts=computed(()=>batch.value?.counts||{});
const finishedCount=computed(()=>['succeeded','failed','cancelled','unknown','duplicate','interrupted'].reduce((total,key)=>total+Number(counts.value[key]||0),0));
let pollTimer,disposed=false,polling=false,contextVersion=0;
const contextGuard=(id,version)=>!disposed&&d.value.id===id&&contextVersion===version;
function resetPoll(){clearTimeout(pollTimer);pollTimer=undefined;}
function schedulePoll(){resetPoll();if(!disposed&&batchRunning.value)pollTimer=setTimeout(pollBatch,1200);}
async function pollBatch(){
 if(polling||!batch.value)return;
 const draftId=d.value.id,batchId=batch.value.id,version=contextVersion;polling=true;
 try{const result=await call('extractBatchStatus',{id:draftId,batchId});if(contextGuard(draftId,version)&&(selectedBatchId.value||batch.value?.id)===batchId){liveBatch.value=result;error.value='';if(!extractionBatchActive(result))await refresh(false,{expectedId:draftId,guard:()=>contextGuard(draftId,version)});}}
 catch(cause){if(contextGuard(draftId,version))error.value='读取批量进度失败：'+cause.message+'。任务未重新提交，可点击刷新结果。';}
 finally{polling=false;schedulePoll();}
}
watch(()=>[d.value.id,batch.value?.id,batch.value?.status],schedulePoll,{immediate:true});
watch(()=>batch.value?.id||'',id=>emit('batch-visible',id),{immediate:true});
watch(()=>d.value.id,()=>{contextVersion++;resetPoll();selectedBatchId.value='';liveBatch.value=null;batchInput.value='';error.value='';pending.value='';mode.value='single';pickerOpen.value=false;terminationNotes.value={};terminationChecks.value={};},{flush:'sync'});
onBeforeUnmount(()=>{disposed=true;contextVersion++;resetPoll();emit('batch-visible','');});
function chooseBatch(id){selectedBatchId.value=id;liveBatch.value=null;error.value='';pollBatch();}
async function paste(){
 const draftId=d.value.id,version=contextVersion,targetMode=mode.value,before=targetMode==='batch'?batchInput.value:d.value.sourceUrl;
 const current=()=>contextGuard(draftId,version)&&mode.value===targetMode&&(targetMode==='batch'?batchInput.value:d.value.sourceUrl)===before;
 try{const text=await navigator.clipboard.readText();if(!current())return;if(targetMode==='batch')batchInput.value=text;else d.value.sourceUrl=text;}
 catch{if(current())error.value='无法读取剪贴板，请直接粘贴到输入框。';}
}
function moveToBatch(){batchInput.value=d.value.sourceUrl;mode.value='batch';}
async function extract(asset){if(locked.value||blockingBatch.value)return;if(asset&&!['audio','video','text'].includes(asset.type)){error.value='请选择音频、视频或文本文件。';return;}pickerOpen.value=false;return runExtractAction({draft:d,save,act,call,notify},asset);}
async function startBatch(){
 if(!batchReady.value)return;
 const draftId=d.value.id,links=batchInput.value,version=contextVersion;pending.value='start';error.value='';
 try{await save();if(!contextGuard(draftId,version))return;const result=await call('startExtractBatch',{id:draftId,links});if(!contextGuard(draftId,version))return;selectedBatchId.value=result.id;liveBatch.value=result;await refresh(false,{expectedId:draftId,guard:()=>contextGuard(draftId,version)});if(!contextGuard(draftId,version))return;schedulePoll();notify('批量提取已开始，结果仅保存到列表；选用后才进入文案创作。');}
 catch(cause){if(contextGuard(draftId,version))error.value=cause.message;}
 finally{if(contextGuard(draftId,version))pending.value='';}
}
async function stopBatch(){
 if(!batchRunning.value||pending.value==='stop'||batch.value.status==='stopping')return;
 const draftId=d.value.id,batchId=batch.value.id,version=contextVersion;pending.value='stop';error.value='';
 try{const result=await call('cancelExtractBatch',{id:draftId,batchId});if(!contextGuard(draftId,version))return;liveBatch.value=result;await refresh(false,{expectedId:draftId,guard:()=>contextGuard(draftId,version)});if(contextGuard(draftId,version))schedulePoll();}
 catch(cause){if(contextGuard(draftId,version))error.value='停止失败：'+cause.message;}
 finally{if(contextGuard(draftId,version))pending.value='';}
}
async function useItem(item){
 if(locked.value||batchRunning.value||item.status!=='succeeded'||!item.text?.trim())return;
 const draftId=d.value.id,batchId=batch.value.id,version=contextVersion;
 // 选用期间的正文、来源或下游编辑变化，都不能被迟到刷新覆盖。
 const signature=()=>JSON.stringify(['id','sourceUrl','sourceText','rewrite','finalText','confirmed','step'].map(key=>d.value[key]));
 const before=signature();pending.value='use:'+item.id;error.value='';
 try{await save();if(!contextGuard(draftId,version)||signature()!==before)return;const expectedDraft=Object.fromEntries(['sourceUrl','sourceText','rewrite','finalText','confirmed'].map(key=>[key,d.value[key]]));await call('useExtractBatchItem',{id:draftId,batchId,itemId:item.id,expectedDraft});if(!contextGuard(draftId,version)||signature()!==before){notify('当前任务或文案已变化，选用结果已保存在原任务，请重新查看。');return;}const refreshed=await refresh(true,{expectedId:draftId,guard:()=>contextGuard(draftId,version)&&signature()===before});if(!refreshed)return;notify('已选用这条文案并进入第二步，原稿已归档，请核对后继续创作。','success');}
 catch(cause){if(contextGuard(draftId,version))error.value=cause.message;}
 finally{if(contextGuard(draftId,version))pending.value='';}
}
async function reconcileBatch(){
 if(locked.value||!batch.value)return;
 const draftId=d.value.id,batchId=batch.value.id,version=contextVersion;pending.value='reconcile';error.value='';
 try{const result=await call('reconcileExtractBatch',{id:draftId,batchId});if(!contextGuard(draftId,version))return;liveBatch.value=result;await refresh(false,{expectedId:draftId,guard:()=>contextGuard(draftId,version)});}
 catch(cause){if(contextGuard(draftId,version))error.value='核对本地记录失败：'+cause.message;}
 finally{if(contextGuard(draftId,version))pending.value='';}
}
async function confirmTerminated(item){
 const note=String(terminationNotes.value[item.id]||'').trim();
 if(locked.value||item.status!=='unknown'||!terminationChecks.value[item.id]||note.length<8)return;
 const draftId=d.value.id,batchId=batch.value.id,version=contextVersion;pending.value='terminate:'+item.id;error.value='';
 try{const result=await call('confirmExtractBatchTerminated',{id:draftId,batchId,itemId:item.id,expectedRunId:item.runId||'',expectedRemoteId:item.remoteId||'',confirmed:true,note});if(!contextGuard(draftId,version))return;liveBatch.value=result;terminationChecks.value[item.id]=false;await refresh(false,{expectedId:draftId,guard:()=>contextGuard(draftId,version)});}
 catch(cause){if(contextGuard(draftId,version))error.value='确认未完成：'+cause.message;}
 finally{if(contextGuard(draftId,version))pending.value='';}
}
async function openPlatform(platform){try{await window.studio.openPlatformHome(platform);}catch(cause){error.value='打开平台入口失败：'+cause.message;}}
</script>
<template>
<div class="extraction-panel">
 <div class="extraction-modebar"><div class="segmented" role="group" aria-label="提取方式"><button :class="{active:mode==='single'}" :aria-pressed="mode==='single'" :disabled="!!pending" @click="mode='single'">单条提取</button><button :class="{active:mode==='batch'}" :aria-pressed="mode==='batch'" :disabled="!!pending" @click="mode='batch'">批量提取</button></div><span>静默获取，不播放视频</span></div>
 <p v-if="error" class="extraction-error" role="alert">{{error}}</p>
 <div class="two-columns extract-columns">
  <article class="card extract-input extraction-input-card">
   <div class="card-heading"><h3>{{mode==='batch'?'批量视频链接':'视频链接'}}</h3><button class="text-button danger" :disabled="locked" @click="mode==='batch'?batchInput='':d.sourceUrl=''">清空</button></div>
   <template v-if="mode==='single'"><div class="link-input"><I name="Link"/><input v-model="d.sourceUrl" :disabled="locked" placeholder="粘贴视频分享链接或分享文本" aria-label="视频链接"/><button :disabled="locked" @click="paste">粘贴</button></div><div class="or">或</div><button class="upload-zone" :disabled="locked||!!blockingBatch" @click="pickerOpen=true"><I name="Plus" :size="30"/><span><strong>从音频或视频中提取文案</strong><small>点击上传音频/视频，或直接导入已有文本。</small></span></button><button class="primary full" :disabled="!singleReady" @click="extract()"><I name="Link"/>提取文案</button><p class="hint">粘贴一条分享链接或分享文本。多个链接请使用“批量提取”。</p><button v-if="singleInput.total>1" class="secondary" :disabled="locked" @click="moveToBatch">检测到多条链接，改用批量提取</button><div class="platform-hints"><span>快捷打开</span><button type="button" aria-label="打开抖音" @click="openPlatform('douyin')">抖</button><button type="button" aria-label="打开快手" @click="openPlatform('kuaishou')">快</button><button type="button" aria-label="打开小红书" @click="openPlatform('xiaohongshu')">红</button></div></template>
   <template v-else><label class="extraction-batch-label">分享链接或完整分享文本<textarea v-model="batchInput" :disabled="locked||batchRunning" aria-label="批量视频分享链接" placeholder="每条分享文本另起一行，也可一次粘贴多个链接。&#10;https://v.douyin.com/…&#10;https://v.kuaishou.com/…"/></label><div class="extraction-input-count" aria-live="polite"><span>共 {{inputPreview.total}} 项（每批最多 50 项）</span><strong>{{inputPreview.unique}} 条待提取</strong><span v-if="inputPreview.duplicates">{{inputPreview.duplicates}} 条相同地址将去重</span><span v-if="inputPreview.invalid" class="extraction-invalid-count">{{inputPreview.invalid}} 项未识别有效链接</span></div><p class="hint">输入条数为预览，最终以服务端解析结果为准。无效行会列出原因；请删去不属于分享文本的独立标题行。逐条提取，单条失败会保留原因并继续处理其他链接。</p><div class="extraction-input-actions"><button :disabled="locked||batchRunning" @click="paste"><I name="Copy" :size="16"/>粘贴链接</button><button class="primary" :disabled="!batchReady" @click="startBatch"><I name="List" :size="16"/>{{pending==='start'?'正在创建…':'开始批量提取'}}</button></div><p class="hint">批量结果不会自动替换原文案。先检查结果，再选择一条进入后续创作。</p></template>
   <p v-if="blockingBatch" class="extraction-notice" role="status">{{extractionBatchActive(blockingBatch)?'当前任务有批量提取正在处理，请等待完成或停止后再提取。':'当前批次有结果待确认，请先在任务中心核对执行状态，避免重复提交。'}}<button v-if="blockingBatch.id!==batch?.id" @click="mode='batch';chooseBatch(blockingBatch.id)">查看该批次</button></p>
  </article>
  <article class="card text-card extraction-source-card"><div class="card-heading"><h3>当前原文案</h3><button class="text-button" :disabled="locked" @click="d.sourceText=''">清空</button></div><textarea v-model="d.sourceText" :disabled="!!pending" class="large-text" placeholder="单条提取的文案将在这里显示，也可以直接输入或粘贴。批量结果请在下方逐条选用。" aria-label="原文案"/><div class="extraction-source-note"><span>批量提取期间可保留当前稿件</span><span>{{d.sourceText.length}} 字</span></div></article>
 </div>
 <section v-if="batch||batches.length" class="card extraction-results" aria-label="批量提取结果">
  <header class="extraction-results-heading"><div><h3>批量提取结果</h3><p class="hint">选用一条后进入第二步；当前原稿、改写和最终文案会先归档，再切换为选用结果。</p></div><div class="extraction-result-actions"><select v-if="batches.length>1" :value="batch?.id" aria-label="选择历史提取批次" :disabled="!!pending" @change="chooseBatch($event.target.value)"><option v-for="(item,index) in batches" :key="item.id" :value="item.id">批次 {{batches.length-index}} · {{extractionStatusLabel(item.status)}} · {{item.counts?.total||item.items?.length||0}} 条</option></select><button v-if="batch?.status==='unknown'" :disabled="locked" @click="reconcileBatch">核对本地执行记录</button><button :disabled="!!pending" @click="pollBatch"><I name="RefreshCw" :size="15"/>刷新结果</button><button v-if="batchRunning" class="extraction-stop" :disabled="pending==='stop'||batch.status==='stopping'" @click="stopBatch"><I name="Square" :size="14"/>{{pending==='stop'||batch.status==='stopping'?'正在停止…':'停止批量提取'}}</button></div></header>
  <template v-if="batch"><div class="extraction-summary" role="status"><strong>{{extractionStatusLabel(batch.status)}}</strong><span>已处理 {{finishedCount}} / {{counts.total||batch.items.length}} 条</span><span>成功 {{counts.succeeded||0}}</span><span v-if="counts.failed">失败 {{counts.failed}}</span><span v-if="counts.cancelled">已停止 {{counts.cancelled}}</span><span v-if="counts.duplicate">去重 {{counts.duplicate}}</span><span v-if="counts.unknown">待确认 {{counts.unknown}}</span></div><progress class="extraction-total-progress" :value="extractionProgress(batch.progress)" max="100" aria-label="批量提取总进度"/><p v-if="batch.status==='stopping'" class="extraction-notice">已请求停止，等待当前提取退出；未开始的链接会标记停止，已成功的结果仍保留。</p><div class="extraction-result-list"><article v-for="(item,index) in batch.items" :key="item.id" class="extraction-result-item" :class="'is-'+item.status"><div class="extraction-item-heading"><span class="extraction-item-number">{{index+1}}</span><span class="extraction-item-url" :title="item.url">{{item.url||item.originalShareText}}</span><span class="extraction-item-status">{{item.terminationReceipt?'已按人工回执解除待确认':extractionStatusLabel(item.status)}}</span></div><progress v-if="item.status==='running'" :value="extractionProgress(item.progress)" max="100" :aria-label="'第 '+(index+1)+' 条提取进度'"/><p v-if="extractionItemMessage(item)" class="extraction-item-message" :class="{'extraction-error':item.error&&!item.terminationReceipt}">{{extractionItemMessage(item)}}</p><details v-if="item.terminationReceipt" class="extraction-unknown extraction-receipt"><summary>人工核实回执</summary><p>依据：用户已在原服务核实终止。程序没有查询或自动验证远程终止。</p><p>核实说明：{{item.terminationReceipt.note}}</p><p>原远程编号：{{item.terminationReceipt.remoteId||'未返回'}}；本地运行编号：{{item.terminationReceipt.runId||'未创建'}}。</p><p>记录时间：{{item.terminationReceipt.confirmedAt}}</p><details v-if="item.unresolvedHistory?.length"><summary>查看处理前的未知状态</summary><p v-for="(record,recordIndex) in item.unresolvedHistory" :key="recordIndex">{{record.error||record.message||record.status}} · {{record.archivedAt}}</p></details></details><details v-if="item.status==='unknown'" class="extraction-unknown"><summary>结果待确认，查看处理方式</summary><p>远程任务编号：{{item.remoteId||'未返回远程编号'}}；本地运行编号：{{item.runId||'未创建运行编号'}}。</p><p>核对本地执行记录只同步已保存的状态，不会查询远程服务。请先在原服务中核实任务；未核实时请保留待确认，避免重复生成。</p><label>核实说明<textarea v-model="terminationNotes[item.id]" maxlength="2000" :disabled="locked" :aria-label="'第 '+(index+1)+' 条远程终止核实说明'" placeholder="填写核实渠道及任务已结束且没有可用结果的依据，至少8字。"/></label><label class="extraction-termination-check"><input v-model="terminationChecks[item.id]" type="checkbox" :disabled="locked"/><span>我已在原服务核实此任务终止，且没有可用结果</span></label><button :disabled="locked||!terminationChecks[item.id]||(terminationNotes[item.id]||'').trim().length<8" @click="confirmTerminated(item)">记录人工核实结果并解除待确认</button></details><template v-if="item.status==='succeeded'"><details class="extraction-result-text"><summary>查看文案 · {{item.text?.length||0}} 字</summary><p>{{item.text}}</p></details><div class="extraction-use-row"><span>请先核对识别文字</span><button class="secondary" :disabled="locked||batchRunning||!item.text?.trim()" @click="useItem(item)">{{pending==='use:'+item.id?'正在选用…':'选用这条，进入第二步'}}<I name="ArrowRight" :size="15"/></button></div></template></article></div></template>
 </section>
 <AssetPicker v-if="pickerOpen" kind="all" title="从音视频或文本中提取文案" @close="pickerOpen=false" @select="extract"/>
</div>
</template>
<style src="../extraction-panel.css"></style>
