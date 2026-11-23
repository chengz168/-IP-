<script setup>
import {computed,inject,ref,watch,onBeforeUnmount} from 'vue';
import I from './Icon.vue';
import AssetPicker from './AssetPicker.vue';
import {call,mediaUrl} from '../api';

const {state,draft:d,busy,workflowLocked,act,refresh,save,notify}=inject('studio');
const includeVisual=ref(false),localAsset=ref(null),pickerOpen=ref(false),analysisWorking=ref(false),scriptWorking=ref(false),selecting=ref(false),stopping=ref(false),stopRequested=ref(false),factsWorking=ref(false),error=ref(''),runId=ref(''),report=ref(null),reportRunId=ref(''),reportInput=ref(null),brief=ref(''),created=ref(null),createdRunId=ref(''),scriptMode=ref('transcript'),sourceScript=ref(''),createdScript=ref(''),visualFacts=ref([]);
let pollTimer,alive=true;const submittedTaskId=ref('');
const factsPlayer=ref(null),detaching=ref(false);
const currentSourceUrl=computed(()=>String(d.value.sourceUrl||'').trim());
const SIGNATURE_FIELDS=['sourceUrl','sourceText','rewrite','finalText','confirmed','wordLimit','language','template'];
const activeRun=computed(()=>state.value.runs.find(run=>(runId.value?run.id===runId.value:run.draftId===(submittedTaskId.value||d.value.id)&&['reference-analysis','reference-script'].includes(run.type))&&['running','queued','unknown'].includes(run.status))||null);
const locked=computed(()=>!!busy.value||workflowLocked.value||analysisWorking.value||scriptWorking.value||selecting.value||stopping.value||factsWorking.value||detaching.value||!!activeRun.value);
const hasInput=computed(()=>!!currentSourceUrl.value||!!localAsset.value?.id);
const historicalReports=computed(()=>state.value.runs.filter(run=>run.draftId===d.value.id&&run.type==='reference-analysis'&&run.status==='succeeded'&&run.output?.transcript).map(run=>{const snapshot=run.snapshot||{},input={taskId:run.draftId,sourceUrl:String(snapshot.sourceUrl??run.output.source?.url??'').trim(),assetId:run.parameters?.assetId||''};for(const field of SIGNATURE_FIELDS)if(field!=='sourceUrl')input[field]=snapshot[field];return {runId:run.id,output:run.output,input};}));
const historicalScripts=computed(()=>state.value.runs.filter(run=>run.draftId===d.value.id&&run.type==='reference-script'&&run.status==='succeeded'&&run.output?.sourceRunId===reportRunId.value&&run.output?.text));
const currentReport=computed(()=>report.value);
const currentReportRunId=computed(()=>reportRunId.value);
const sourceStale=computed(()=>{if(!reportInput.value||!!currentReport.value?.stale||reportInput.value.taskId!==d.value.id)return true;const live=inputSnapshot();return SIGNATURE_FIELDS.some(field=>reportInput.value[field]!==live[field])||reportInput.value.assetId!==(localAsset.value?.id||'');});
const canReviewFacts=computed(()=>!!currentReport.value?.visual?.observations?.length&&!currentReport.value?.stale&&reportInput.value?.taskId===d.value.id&&(reportInput.value?.sourceUrl===currentSourceUrl.value)&&(reportInput.value?.assetId===(localAsset.value?.id||'')));
const factsDirty=computed(()=>JSON.stringify(visualFacts.value)!==JSON.stringify(currentReport.value?.visualFactsReview?.facts||[]));
const factsComplete=computed(()=>visualFacts.value.length>0&&visualFacts.value.length<=100&&visualFacts.value.every(row=>Number.isInteger(row.sample)&&currentReport.value?.visual?.observations?.[row.sample]&&['name','color','structure','use'].every(key=>typeof row[key]==='string'&&row[key].trim())));
const factsStatus=computed(()=>!canReviewFacts.value?'来源变化，核对不可用于当前来源':factsDirty.value?'有未保存的核对修改':currentReport.value?.visualFactsReview?'已保存实体核对 · 第 '+(currentReport.value.visualFactsReview.revision||1)+' 版':'尚未核对实体事实');
const reportLabel=computed(()=>sourceStale.value?'来源已变化，此报告仅供查看，不能覆盖当前文案':'输入未变化，选用时仍由后台校验来源');
const selectedScript=computed(()=>scriptMode.value==='created'?createdScript.value:sourceScript.value);
const hasOutline=computed(()=>!!currentReport.value?.outline?.text);
const sourceScriptLabel=computed(()=>hasOutline.value?'画面脚本（分析草案，可编辑）':'原始脚本（可编辑）');
const contentTypeLabel=computed(()=>({'spoken':'口播或对白','music-visual':'音乐与画面叙事','mixed':'音画混合','uncertain':'类型暂不确定'}[currentReport.value?.analysis?.contentType]||'类型未提供'));
const audioRoleLabel=computed(()=>{const role=currentReport.value?.analysis?.audioRole??currentReport.value?.audioRole;return typeof role==='string'?role:role?.description||role?.role||'';});
const canUseScript=computed(()=>!!currentReport.value&&!factsDirty.value&&!sourceStale.value&&!!currentReportRunId.value&&selectedScript.value.trim().length>=20&&selectedScript.value.trim().length<=20000&&!(scriptMode.value==='created'&&(!createdRunId.value||created.value?.stale))&&!locked.value);

function inputSnapshot(){const snapshot={taskId:d.value.id,sourceUrl:currentSourceUrl.value,assetId:localAsset.value?.id||''};for(const field of SIGNATURE_FIELDS)if(field!=='sourceUrl')snapshot[field]=d.value[field];return snapshot;}
function sameInput(snapshot){const current=inputSnapshot();return snapshot.taskId===current.taskId&&snapshot.sourceUrl===current.sourceUrl&&snapshot.assetId===current.assetId&&SIGNATURE_FIELDS.filter(field=>field!=='sourceUrl').every(field=>snapshot[field]===current[field]);}

function runIdFor(type,result){
 if(result?.runId)return result.runId;
 const candidates=state.value.runs.filter(run=>run.draftId===d.value.id&&run.type===type&&run.status==='succeeded');
 if(type==='reference-analysis')return candidates.find(run=>run.output?.inputSignature&&result?.inputSignature&&run.output.inputSignature===result.inputSignature)?.id||'';
 return candidates.find(run=>run.output?.sourceRunId===result?.sourceRunId&&run.output?.text===result?.text)?.id||'';
}
function syncReport(next,sourceRunId='',input=inputSnapshot()){
 report.value=next;reportRunId.value=sourceRunId||runIdFor('reference-analysis',next);reportInput.value=input;sourceScript.value=String(next?.outline?.text||next?.transcript?.text||'');created.value=null;createdScript.value='';createdRunId.value='';scriptMode.value='transcript';visualFacts.value=JSON.parse(JSON.stringify(next?.visualFactsReview?.facts||[]));
}
function startPolling(){clearInterval(pollTimer);pollTimer=setInterval(async()=>{try{await refresh();const run=activeRun.value;if(run)runId.value=run.id;}catch{/* 主工作台负责显示刷新失败 */}},800);}
function stopPolling(){clearInterval(pollTimer);pollTimer=undefined;}
function chooseLocal(asset){if(locked.value)return;if(!['audio','video'].includes(asset?.type)){error.value='请选择音频或视频，图片不能用于脚本拆解';return;}localAsset.value=asset;pickerOpen.value=false;error.value='';}
async function analyze(){
 if(locked.value||!hasInput.value)return;error.value='';analysisWorking.value=true;stopRequested.value=false;runId.value='';const input=inputSnapshot();submittedTaskId.value=input.taskId;startPolling();
 try{await save();if(!sameInput(input))throw Error('来源或任务已变化，请重新解析');const result=await act('解析对标视频',async()=>{try{return await call('analyzeReferenceVideo',{id:input.taskId,assetId:input.assetId||undefined,includeVisual:!!includeVisual.value});}catch(e){error.value=e.message;throw e;}});if(!result){if(!error.value)error.value='解析未完成，请检查执行记录';return;}await refresh();if(!alive||!sameInput(input)||stopRequested.value){error.value='来源已变化或已请求停止，本次报告保留在执行记录，未覆盖当前报告';return;}if((!result.transcript?.text&&!result.outline?.text)||!result.analysis)throw Error('服务未返回完整脚本拆解报告');syncReport(result,'',input);}
 catch(e){error.value=e.message;}finally{analysisWorking.value=false;submittedTaskId.value='';stopPolling();}
}
async function stop(){if(stopping.value||stopRequested.value)return;stopping.value=true;try{if(!activeRun.value)await refresh();const run=activeRun.value;if(!run)throw Error('尚未取得本次解析任务，请稍候重试');await call('cancelRun',{id:run.id});stopRequested.value=true;await refresh();}catch(e){error.value='停止解析失败：'+e.message;}finally{stopping.value=false;}}
async function createScript(){
 if(locked.value||sourceStale.value||!currentReportRunId.value||!brief.value.trim())return;error.value='';scriptWorking.value=true;stopRequested.value=false;runId.value='';const reportId=currentReportRunId.value,input=inputSnapshot(),submittedBrief=brief.value.trim();submittedTaskId.value=input.taskId;startPolling();
 try{await save();if(!sameInput(input)||reportId!==currentReportRunId.value)throw Error('任务或来源已变化，请重新选择报告');const result=await act('生成对标创作稿',async()=>{try{return await call('createReferenceScript',{id:input.taskId,runId:reportId,brief:submittedBrief});}catch(e){error.value=e.message;throw e;}});if(!result){if(!error.value)error.value='创作未完成，请检查执行记录';return;}await refresh();if(!alive||!sameInput(input)||reportId!==currentReportRunId.value||submittedBrief!==brief.value.trim()||stopRequested.value){error.value='输入已变化或已请求停止，创作结果保留在执行记录，未覆盖编辑区';return;}if(!result.text||result.sourceRunId!==reportId)throw Error('创作服务未返回与当前报告对应的文案');created.value=result;createdScript.value=result.text;createdRunId.value=runIdFor('reference-script',result);scriptMode.value='created';}
 catch(e){error.value=e.message;}finally{scriptWorking.value=false;submittedTaskId.value='';stopPolling();}
}
function addVisualFact(){if(locked.value||!canReviewFacts.value||visualFacts.value.length>=100)return;visualFacts.value.push({id:crypto.randomUUID(),sample:0,name:'',color:'',structure:'',use:''});}
function removeVisualFact(index){if(!locked.value)visualFacts.value.splice(index,1);}
function seekSample(sample){const time=Number(currentReport.value?.visual?.observations?.[sample]?.time);if(factsPlayer.value&&Number.isFinite(time)&&time>=0){factsPlayer.value.pause();factsPlayer.value.currentTime=time;}}
async function detachReference(){
 if(locked.value||detaching.value||!d.value.referenceSelection)return;const id=d.value.id;detaching.value=true;error.value='';
 try{await save();if(id!==d.value.id)throw Error('任务已变化，未解除参考');await call('detachReferenceSource',{id});await refresh(true);notify('已脱离参考；文案和历史媒体保留，后续重新确认选用','success');}catch(e){error.value=e.message;}finally{detaching.value=false;}
}
async function confirmVisualFacts(){
 if(locked.value||!canReviewFacts.value||!factsComplete.value)return;
 const input=inputSnapshot(),reportId=currentReportRunId.value,facts=JSON.parse(JSON.stringify(visualFacts.value));error.value='';factsWorking.value=true;
 try{await save();if(!sameInput(input)||reportId!==currentReportRunId.value)throw Error('任务或来源已变化，未保存核对');const review=await call('confirmReferenceVisualFacts',{id:input.taskId,runId:reportId,facts});await refresh();if(!alive||!sameInput(input)||reportId!==currentReportRunId.value)return;report.value={...report.value,visualFactsReview:review};visualFacts.value=JSON.parse(JSON.stringify(review.facts));notify('实体核对已保存；回到视频生成重新提取资产后应用新版本','success');}
 catch(e){error.value=e.message;}finally{factsWorking.value=false;}
}
async function useScript(){
 if(!canUseScript.value)return;const kind=scriptMode.value==='created'?'created':hasOutline.value?'outline':'transcript';const sourceRun=kind==='created'?createdRunId.value:currentReportRunId.value;if(!sourceRun){error.value='缺少可核对的报告任务ID，不能覆盖当前文案';return;}const text=selectedScript.value.trim(),input=inputSnapshot();error.value='';selecting.value=true;try{await save();if(!sameInput(input))throw Error('来源或任务已变化，未选用文案');await call('useReferenceScript',{id:input.taskId,runId:sourceRun,kind,text});await refresh(d.value.id===input.taskId);notify(kind==='created'?'已使用创作稿，进入第二步继续确认':kind==='outline'?'已使用画面脚本草案，进入第二步继续核对':'已使用原始脚本，进入第二步继续确认','success');}catch(e){error.value=e.message;}finally{selecting.value=false;}}
function restoreReport(row){if(locked.value||!row?.output)return;syncReport(row.output,row.runId,row.input);}
function restoreScript(run){if(locked.value||!run?.output)return;created.value=run.output;createdScript.value=run.output.text;createdRunId.value=run.id;brief.value=run.output.brief||'';scriptMode.value='created';}
function timeLabel(start,end){const part=value=>value===null||value===undefined||!Number.isFinite(Number(value))?'时间未确定':Number(value).toFixed(2)+'s';return part(start)+' — '+part(end);}
function basisLabel(basis){return {'transcript':'原始音轨文字','transcript-analysis':'音轨文字分析','visual':'实际采样画面','visual-analysis':'画面分析','mixed':'音画共同依据','none':'未识别可靠依据','uncertain':'依据暂不确定'}[basis]||basis||'依据未提供';}
function sourceBasisLabel(basis){return {'video':'视频文件','audio':'音频文件','text-bridge':'链接文字服务（未核验原媒体）'}[basis]||basis||'未提供来源依据';}
function visualStatusLabel(status){return {'succeeded':'已完成采样观察','not-requested':'未启用','disabled':'未启用','unavailable':'无可观察画面','unconfigured':'未配置视觉模型','failed':'观察失败'}[status]||status||'未提供';}
function structureTimeLabel(item){return (['visual','visual-analysis'].includes(item?.basis)?'采样范围：':'')+timeLabel(item?.start,item?.end);}
watch(()=>historicalReports.value[0]?.runId,id=>{if(!report.value&&id&&!analysisWorking.value&&!scriptWorking.value){const row=historicalReports.value[0];syncReport(row.output,row.runId,row.input);if(row.input.assetId)localAsset.value=state.value.assets.find(asset=>asset.id===row.input.assetId)||null;}},{immediate:true});
watch(()=>d.value.id,()=>{report.value=null;reportRunId.value='';reportInput.value=null;localAsset.value=null;created.value=null;createdScript.value='';createdRunId.value='';sourceScript.value='';brief.value='';visualFacts.value=[];error.value='';},{flush:'sync'});
onBeforeUnmount(()=>{alive=false;stopPolling();});
</script>

<template>
 <section class="reference-analysis" aria-label="视频拆解">
  <div class="reference-analysis-head"><div><h3>视频拆解</h3><p>分析单条视频的文案、钩子和段落结构，再以自己的主题与事实创作。</p></div></div>
  <div v-if="d.referenceSelection" class="reference-detach"><p>当前创作关联了参考来源。若改为独立创作，可解除关联；文案和历史素材保留，旧视频选用将撤销。</p><button :disabled="locked||detaching" @click="detachReference">{{detaching?'正在解除…':'脱离此参考来源'}}</button></div>
  <div class="reference-source card">
   <div class="card-heading"><h4>来源</h4><span class="reference-source-status">{{hasInput?'已填写来源':'填写链接或选择音视频'}}</span></div>
   <div class="reference-url-row"><I name="Link"/><input v-model="d.sourceUrl" :disabled="locked" aria-label="对标视频分享链接" placeholder="粘贴分享链接或分享文本"/><button :disabled="locked" @click="d.sourceUrl=''">清空</button></div>
   <div class="reference-source-actions"><button :disabled="locked" @click="pickerOpen=true"><I name="Upload" :size="15"/>选择本地音视频</button><span v-if="localAsset">{{localAsset.name||localAsset.id}}</span><button v-if="localAsset" :disabled="locked" @click="localAsset=null">改用链接</button><label class="reference-visual-toggle"><input v-model="includeVisual" type="checkbox" :disabled="locked"/>同时观察画面</label><button class="primary" :disabled="locked||!hasInput" @click="analyze"><I name="Search" :size="15"/>{{analysisWorking?'解析中…':'解析视频'}}</button></div>
   <p class="hint">{{localAsset?'本次分析所选本地文件，分享链接暂不作为媒体来源。':'静默提取文字，不播放视频。'}}画面观察只分析实际采样帧，报告保留覆盖范围与限制。</p>
  </div>
  <p v-if="error" class="reference-error" role="alert">{{error}}</p>
  <p v-if="analysisWorking||scriptWorking" class="reference-progress" role="status">{{stopRequested?'已请求停止，正在等待任务退出…':activeRun?'正在处理 · '+Math.round(Number(activeRun.progress)||0)+'%':'正在准备任务…'}}</p>
  <section v-if="currentReport" class="reference-report card">
   <header class="reference-report-header"><div><h4>拆解报告</h4><span :class="{'is-stale':sourceStale}">{{reportLabel}}</span></div><select v-if="historicalReports.length" :value="currentReportRunId" :disabled="locked" aria-label="历史解析报告" @change="restoreReport(historicalReports.find(row=>row.runId===$event.target.value))"><option v-for="(row,index) in historicalReports" :key="row.runId" :value="row.runId">报告 {{index+1}} · {{row.output.source?.title||row.output.source?.url||'本地来源'}}</option></select></header>
   <div class="reference-source-meta"><span>{{currentReport.source?.title||currentReport.source?.url||'本地文件'}}</span><span v-if="currentReport.source?.duration">时长 {{Number(currentReport.source.duration).toFixed(2)}} 秒</span><span>{{sourceBasisLabel(currentReport.source?.basis)}}</span></div>
   <p v-if="currentReport.analysis?.summary" class="reference-summary">{{currentReport.analysis.summary}}</p>
   <div class="reference-content-notice"><strong>内容类型：{{contentTypeLabel}}</strong><p v-if="audioRoleLabel">音轨角色：{{audioRoleLabel}}</p><p v-if="hasOutline">以下脚本来自实际采样画面的分析草案，不是视频原声旁白；请核对可见动作、顺序和未观察到的部分。音轨识别文字可能包含歌词。</p></div>
   <div class="reference-transcript"><div class="reference-section-title"><strong>{{sourceScriptLabel}}</strong><span>{{sourceScript.length}} 字</span></div><textarea v-model="sourceScript" :aria-label="hasOutline?'画面脚本编辑':'原始脚本编辑'" maxlength="20000" :disabled="locked||sourceStale"/><details><summary>{{hasOutline?'音轨识别文字（可能包含歌词）':'查看原始识别文字与逐句时间轴'}}</summary><p class="reference-raw-text">{{currentReport.transcript?.text||'没有可靠音轨识别文字'}}</p><div class="reference-timeline"><article v-for="(segment,index) in currentReport.transcript?.segments||[]" :key="index"><time>{{timeLabel(segment.start,segment.end)}}</time><p>{{segment.text}}</p></article></div><p v-if="!currentReport.transcript?.segments?.length" class="hint">音轨识别未提供有效逐句时间轴，不推测音轨秒数；画面采样时间另列于下方。</p></details></div>
   <div class="reference-grid">
    <article><h5>开头钩子</h5><p><b>{{currentReport.analysis?.hook?.kind}}</b></p><small class="reference-basis">依据：{{basisLabel(currentReport.analysis?.hook?.basis)}}</small><blockquote v-if="currentReport.analysis?.hook?.quote">{{currentReport.analysis.hook.quote}}</blockquote><time>{{structureTimeLabel(currentReport.analysis?.hook)}}</time><small>{{currentReport.analysis?.hook?.explanation||'暂无可靠说明'}}</small></article>
    <article><h5>段落结构</h5><ol><li v-for="(item,index) in currentReport.analysis?.sections||[]" :key="index"><b>{{item.label}}</b><small class="reference-basis">依据：{{basisLabel(item.basis)}}</small><span>{{item.purpose}}</span><blockquote v-if="item.quote">{{item.quote}}</blockquote><time>{{structureTimeLabel(item)}}</time></li></ol></article>
    <article><h5>结尾表达</h5><small class="reference-basis">依据：{{basisLabel(currentReport.analysis?.ending?.basis)}}</small><blockquote v-if="currentReport.analysis?.ending?.quote">{{currentReport.analysis.ending.quote}}</blockquote><time>{{structureTimeLabel(currentReport.analysis?.ending)}}</time><small>{{currentReport.analysis?.ending?.explanation||'暂无可靠说明'}}</small></article>
    <article><h5>可复用结构</h5><ul><li v-for="(item,index) in currentReport.analysis?.reusableStructure||[]" :key="index">{{item}}</li></ul><h5>不确定项</h5><ul><li v-for="(item,index) in currentReport.analysis?.uncertainties||[]" :key="index">{{item}}</li></ul></article>
   </div>
   <div class="reference-visual"><p class="hint">以下时间为实际画面采样点或采样范围，不代表镜头切换边界。</p><h5>画面观察 · {{visualStatusLabel(currentReport.visual?.status)}}</h5><p>{{currentReport.visual?.limitation||'没有可靠画面观察，不能推断完整剪辑。'}}</p><ul><li v-for="(item,index) in currentReport.visual?.observations||[]" :key="index">采样点 {{item.time==null?'时间未确定':Number(item.time).toFixed(2)+'s'}} · {{item.description}}</li></ul></div>
   <section v-if="currentReport.visual?.status==='succeeded'&&currentReport.visual.observations?.length" class="reference-facts" aria-label="参考实体事实核对">
    <div class="reference-facts-heading"><div><h5>实体事实核对</h5><p>模型可能认错物件、颜色和结构。对照原视频补充事实，原始画面观察继续保留；不确定的字段填写“不确定”。</p></div><span role="status">{{factsStatus}}</span></div>
    <video v-if="currentReport.source?.assetId" ref="factsPlayer" class="reference-facts-video" :src="mediaUrl(currentReport.source.assetId)" controls preload="metadata" aria-label="用于核对实体的原始参考视频"/>
    <div class="reference-sample-links" aria-label="原片采样跳转"><button v-for="(item,sample) in currentReport.visual.observations" :key="sample" @click="seekSample(sample)">采样 {{sample+1}} · {{Number(item.time).toFixed(2)}} 秒</button></div>
    <div v-for="(fact,index) in visualFacts" :key="fact.id" class="reference-fact-row">
     <header><strong>实体 {{index+1}}</strong><button :disabled="locked||!canReviewFacts" :aria-label="'删除实体 '+(index+1)+' 核对'" @click="removeVisualFact(index)">删除</button></header>
     <div class="reference-fact-fields"><label>对应采样点<select v-model.number="fact.sample" :disabled="locked||!canReviewFacts" :aria-label="'实体 '+(index+1)+' 对应采样点'"><option v-for="(item,sample) in currentReport.visual.observations" :key="sample" :value="sample">{{sample+1}} · {{Number(item.time).toFixed(2)}} 秒</option></select></label><label>实体名称<input v-model="fact.name" maxlength="200" :disabled="locked||!canReviewFacts" :aria-label="'实体 '+(index+1)+' 名称'" placeholder="例如：接砂盒"/></label><label>颜色<input v-model="fact.color" maxlength="300" :disabled="locked||!canReviewFacts" :aria-label="'实体 '+(index+1)+' 颜色'" placeholder="例如：米白色"/></label><label>结构与外观<textarea v-model="fact.structure" maxlength="1000" :disabled="locked||!canReviewFacts" :aria-label="'实体 '+(index+1)+' 结构'" placeholder="例如：内壁光滑，无筛孔"/></label><label>可核实用途<textarea v-model="fact.use" maxlength="1000" :disabled="locked||!canReviewFacts" :aria-label="'实体 '+(index+1)+' 用途'" placeholder="仅填写实际可核实用途；无法判断时填不确定"/></label></div>
    </div>
    <p v-if="!visualFacts.length" class="hint">还没有实体核对记录。若要沿用参考画面生成资产、图片或视频，请先核对其中的主要物件。</p>
    <div class="reference-facts-actions"><button :disabled="locked||!canReviewFacts||visualFacts.length>=100" @click="addVisualFact">添加实体</button><button class="primary" :disabled="locked||!canReviewFacts||!factsComplete||!factsDirty" @click="confirmVisualFacts">{{factsWorking?'正在保存…':'保存并确认实体事实'}}</button></div>
    <p v-if="factsDirty" class="hint" role="status">当前核对修改尚未保存，请先保存并确认，再选用脚本。</p><p class="hint">修改核对后，需要回到第四步重新提取资产以应用。相关旧图片与视频仍保留为历史候选，需重新检查确认；实体事实确认不代表生成画面质量已通过。</p>
   </section>
  </section>
  <section v-if="currentReport" class="reference-create card">
   <div class="reference-script-tabs"><button :disabled="locked" :class="{active:scriptMode==='transcript'}" @click="scriptMode='transcript'">{{hasOutline?'画面脚本':'原始脚本'}}</button><button :class="{active:scriptMode==='created'}" :disabled="locked||!createdScript" @click="scriptMode='created'">创作稿</button></div>
   <label>创作要求与事实依据<textarea v-model="brief" maxlength="10000" :disabled="locked||sourceStale" placeholder="填写自己的主题、受众、素材事实和创作要求。原视频只作为写法结构参考。"/></label>
   <button class="secondary" :disabled="locked||sourceStale||!currentReportRunId||!brief.trim()" @click="createScript"><I name="PencilLine" :size="15"/>{{scriptWorking?'生成中…':'按结构生成创作稿'}}</button>
   <select v-if="historicalScripts.length" aria-label="历史创作稿" :disabled="locked" :value="createdRunId" @change="restoreScript(historicalScripts.find(run=>run.id===$event.target.value))"><option disabled value="">选择已有创作稿</option><option v-for="(run,index) in historicalScripts" :key="run.id" :value="run.id">创作稿 {{index+1}} · {{run.output.brief?.slice(0,40)}}</option></select>
   <label v-if="scriptMode==='created'" class="reference-edit-label">创作稿（可编辑）<textarea v-model="createdScript" maxlength="20000" aria-label="创作稿编辑" :disabled="locked||sourceStale"/><small v-if="created?.stale">输入已变化，不能选用这份创作稿。</small></label><p v-else class="hint">{{hasOutline?'请核对画面分析草案，不要将音轨歌词当作原始旁白。':'请在报告中核对、编辑原始脚本。'}}选用后进入第二步，不会自动确认。</p>
  </section>
  <footer class="reference-action-footer"><span>{{currentReport?sourceStale?'来源变化，请重新解析或只读查看旧报告':'选用后进入第二步，配音与视频沿用现有流程':'解析后预览报告，确认内容再选用'}}</span><button v-if="analysisWorking||scriptWorking" class="reference-stop" :disabled="stopping||stopRequested" @click="stop"><I name="Square" :size="14"/>{{stopRequested||stopping?'正在停止…':'停止处理'}}</button><button v-if="currentReport" class="primary" :disabled="!canUseScript" @click="useScript">{{selecting?'正在选用…':scriptMode==='created'?'使用创作稿进入第二步':hasOutline?'使用画面脚本进入第二步':'使用原始脚本进入第二步'}}</button></footer>
  <AssetPicker v-if="pickerOpen" kind="audio" title="选择对标音视频" @close="pickerOpen=false" @select="chooseLocal"/>
 </section>
</template>
