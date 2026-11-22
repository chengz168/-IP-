<script setup>
import {computed,inject,onBeforeUnmount,ref,watch} from 'vue';
import {call} from '../api';
import '../creative-presets.css';
import {creativeStageNames} from '../../server/production-skills.mjs';

const props=defineProps({stage:{type:String,default:'script'},context:{type:Object,default:()=>({})},disabled:Boolean});
const {draft:d,state,busy,workflowLocked,save,refresh}=inject('studio');
const catalog=ref([]),route=ref(null),mode=ref('auto'),presetId=ref(''),instruction=ref(''),error=ref(''),loading=ref(false),saving=ref(false);
const saved=ref(''),loaded=ref(false);
let requestToken=0,saveToken=0,refreshTimer;
const stageNames={...creativeStageNames,analysis:'参考拆解'};
const selection=()=>({mode:mode.value,presetId:presetId.value,instruction:instruction.value});
const normalize=value=>({mode:['auto','manual','off'].includes(value?.mode)?value.mode:'auto',presetId:String(value?.presetId||''),instruction:String(value?.instruction||'')});
const dirty=computed(()=>JSON.stringify(selection())!==saved.value);
const locked=computed(()=>props.disabled||!!busy?.value||!!workflowLocked?.value||saving.value);
const options=computed(()=>catalog.value.filter(item=>item.stages?.includes(props.stage)));
const manualMismatch=computed(()=>mode.value==='manual'&&!!presetId.value&&!options.value.some(item=>item.id===presetId.value));
const actual=computed(()=>state.value.runs?.find(run=>run.draftId===d.value.id&&run.output?.creativePreset&&run.output.modelExecuted!==false&&run.output.creativePreset.stage===props.stage)?.output.creativePreset);
// 内容类型画像只负责解释自动路由结果，不能把模型猜测当成已确认事实。
const contentProfile=computed(()=>route.value?.contentProfile||route.value?.profile||null);
const pipelineNames={...stageNames,avatar:'人物口型',subtitle:'字幕',edit:'剪辑','product-script':'商品脚本','product-video':'商品视频'};
const contentPipeline=computed(()=>Array.isArray(contentProfile.value?.pipeline)?contentProfile.value.pipeline.map(step=>pipelineNames[step]||'制作步骤'):[]);
const contentRequires=computed(()=>Array.isArray(contentProfile.value?.requires)?contentProfile.value.requires:[]);
const contentCandidates=computed(()=>Array.isArray(contentProfile.value?.candidates)?contentProfile.value.candidates:[]);
const contentConfidenceLabel=computed(()=>({high:'高',medium:'中',low:'低'}[contentProfile.value?.confidence]||'待确认'));
const contentNeedsConfirmation=computed(()=>contentProfile.value?.needsUserConfirmation===true||['low','medium'].includes(contentProfile.value?.confidence));
const sourceRows=computed(()=>(route.value?.sources||[]).map(source=>typeof source==='string'?{name:source,url:''}:{name:source.name||source.title||source.id||'公开资料',url:source.url||source.sourceUrl||'',version:source.version||source.revision||'',license:source.license||''}));
const rules=computed(()=>Array.isArray(route.value?.rules)?route.value.rules:route.value?.rules?[String(route.value.rules)]:[]);
const routeTitle=computed(()=>route.value?.mode==='off'?'已关闭':route.value?.name||'等待推荐');
function applyContentProfile(){
 const profile=contentProfile.value;
 if(!profile||locked.value)return;
 mode.value='manual';
 presetId.value=String(profile.presetId||'');
}
function setSelection(value){const next=normalize(value);mode.value=next.mode;presetId.value=next.presetId;instruction.value=next.instruction;saved.value=JSON.stringify(next);}
async function loadPreview(){
 const token=++requestToken,id=d.value.id,stage=props.stage;loading.value=true;error.value='';
 try{
  const result=await call('creativePresetPreview',{id,stage,context:props.context});
  if(token!==requestToken||id!==d.value.id||stage!==props.stage)return;
  catalog.value=Array.isArray(result.catalog)?result.catalog:[];route.value=result.route||null;
  // 推荐刷新不能覆盖用户尚未保存的选择或要求。
  if(!loaded.value&&!dirty.value)setSelection(result.selection||d.value.creativePreset);
  loaded.value=true;
 }catch(e){if(token===requestToken&&id===d.value.id)error.value='预设读取失败：'+e.message;}
 finally{if(token===requestToken)loading.value=false;}
}
async function persist(){
 if(locked.value||!loaded.value||(mode.value==='manual'&&(!presetId.value||manualMismatch.value)))return;
 const token=++saveToken,id=d.value.id,stage=props.stage,value=selection();saving.value=true;error.value='';
 try{
  // 先通过现有草稿保存入口保护同页未保存的资料，再保存预设。
  await save();if(token!==saveToken||id!==d.value.id||stage!==props.stage)return;
  await call('saveCreativePreset',{id,selection:value});
  if(token!==saveToken||id!==d.value.id||stage!==props.stage)return;
  await refresh(true);if(token!==saveToken||id!==d.value.id||stage!==props.stage)return;
  setSelection(value);await loadPreview();
 }catch(e){if(token===saveToken&&id===d.value.id)error.value='预设保存失败：'+e.message;}
 finally{if(token===saveToken)saving.value=false;}
}
function reset(){clearTimeout(refreshTimer);requestToken++;saveToken++;route.value=null;catalog.value=[];loading.value=false;saving.value=false;loaded.value=false;error.value='';setSelection(d.value.creativePreset);loadPreview();}
watch([()=>d.value.id,()=>props.stage],reset,{immediate:true});
watch(()=>JSON.stringify(props.context),()=>loadPreview());
// 同任务的保存或后台刷新只更新推荐；编辑中的补充要求继续保留。
watch(()=>JSON.stringify({selection:d.value.creativePreset,text:d.value.sourceText,final:d.value.finalText,product:d.value.product,topic:d.value.topic,marketing:d.value.marketing,tab:d.value.tab}),()=>{
 if(!dirty.value)setSelection(d.value.creativePreset);
 clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>loadPreview(),450);
});
onBeforeUnmount(()=>{clearTimeout(refreshTimer);requestToken++;saveToken++;});
</script>

<template>
 <details class="creative-presets card" :aria-label="'内容创作预设 · '+(stageNames[stage]||stage)">
  <summary class="creative-presets-summary"><span class="creative-presets-title">内容创作预设<small>{{stageNames[stage]||stage}}阶段</small></span><span class="creative-presets-current">{{loading?'正在读取推荐…':error?'预设暂不可用，请展开重试':routeTitle}}</span><span class="creative-presets-expand">设置与规则</span></summary>
  <div class="creative-presets-body">
   <p class="creative-presets-reason" role="status">{{route?.reason||'按已保存的创作资料推荐；修改资料后，请先保存并刷新推荐。'}}</p>
   <section v-if="contentProfile" class="creative-content-profile" aria-label="自动识别的内容类型">
    <div class="creative-content-profile-head"><strong>自动识别类型</strong><span class="creative-content-profile-type">{{contentProfile.name||contentProfile.type||'未命名类型'}}</span><span class="creative-content-profile-confidence" :data-confidence="contentProfile.confidence">置信度：{{contentConfidenceLabel}}</span></div>
    <p v-if="contentProfile.reason" class="creative-content-profile-reason">{{contentProfile.reason}}</p>
    <p v-if="contentPipeline.length" class="creative-content-profile-line"><strong>推荐制作链路：</strong><span v-for="(step,index) in contentPipeline" :key="step+index">{{step}}{{index<contentPipeline.length-1?' → ':''}}</span></p>
    <p v-if="contentRequires.length" class="creative-content-profile-line"><strong>所需资料：</strong>{{contentRequires.join('、')}}</p>
    <div v-if="contentCandidates.length>1" class="creative-content-profile-candidates"><span>候选类型：</span><span v-for="candidate in contentCandidates" :key="candidate.id||candidate.name" class="creative-content-profile-candidate">{{candidate.name||candidate.id}}<small v-if="candidate.score!==undefined">{{candidate.score}}</small></span></div>
    <p v-if="route?.mode==='manual'&&route?.contentProfileApplied===false" class="creative-content-profile-warning">当前已按手动选择的“{{routeTitle}}”执行；上方自动识别仅供参考，其类型规则没有加入本次生成。</p>
    <p v-else-if="contentNeedsConfirmation" class="creative-content-profile-warning" role="status">当前识别依据不足，建议核对后保存适用的创作预设。生成使用已保存设置；自动识别不会新增素材事实。</p>
    <div class="creative-content-profile-actions"><button type="button" :disabled="locked||!loaded" @click="applyContentProfile">填入推荐预设</button><button type="button" :disabled="locked||!loaded" @click="mode='manual'">手动更换预设</button></div>
   </section>
   <fieldset class="creative-presets-modes" :disabled="locked||!loaded"><legend>选择方式</legend><label><input v-model="mode" type="radio" value="auto"/>自动推荐</label><label><input v-model="mode" type="radio" value="manual"/>手动选择</label><label><input v-model="mode" type="radio" value="off"/>关闭预设</label></fieldset>
   <label v-if="mode==='manual'" class="creative-presets-field">创作类型<select v-model="presetId" :disabled="locked||!loaded" aria-label="创作预设类型"><option value="" disabled>请选择适合当前内容的类型</option><option v-if="manualMismatch" :value="presetId" disabled>已选类型不适用当前阶段</option><option v-for="item in options" :key="item.id" :value="item.id">{{item.name}}</option></select></label>
   <p v-if="manualMismatch" class="creative-presets-warning">已选预设不适用当前阶段，请改选或使用自动推荐。</p>
   <label v-if="mode!=='off'" class="creative-presets-field">补充创作要求<textarea v-model="instruction" :disabled="locked||!loaded" rows="2" maxlength="2000" placeholder="例如：面向首次养猫的人，用日常语言说明使用步骤；不要虚构效果。" aria-label="预设补充创作要求"/></label>
   <div class="creative-presets-actions"><p>{{dirty?'尚未保存，生成仍使用已保存设置。':'设置随当前任务保存，系统预设内容保持独立。'}}</p><button type="button" :disabled="locked||loading" @click="loadPreview">刷新推荐</button><button type="button" class="primary" :disabled="locked||!loaded||!dirty||(mode==='manual'&&(!presetId||manualMismatch))" @click="persist">{{saving?'保存中…':'保存预设'}}</button></div>
   <p v-if="error" class="creative-presets-error" role="alert">{{error}}</p>
   <details v-if="route" class="creative-presets-rules"><summary>查看已保存设置的阶段规则与来源</summary><p class="creative-presets-help">{{routeTitle}}<template v-if="route.version"> · 版本 {{route.version}}</template>。推荐用于本阶段，实际采用情况以生成记录为准。</p><ul v-if="rules.length"><li v-for="(rule,index) in rules" :key="index">{{rule}}</li></ul><p v-else class="creative-presets-help">{{route.mode==='off'?'当前已关闭创作预设。':'此预设当前阶段没有附加规则，沿用原有生成要求。'}}</p><div v-if="sourceRows.length" class="creative-presets-sources"><p>公开方法来源（可核查资料地址）</p><div v-for="(source,index) in sourceRows" :key="index"><strong>{{source.name}}</strong><small v-if="source.version">{{source.version}}</small><small v-if="source.license">许可：{{source.license}}</small><code v-if="source.url">{{source.url}}</code></div></div></details>
   <p v-if="route?.skills?.length" class="creative-presets-help">本阶段将组合：{{route.skills.map(skill=>skill.name).join('、')}}。详情可在设置 → 提示词管理 → 创作技能库查看。</p>
   <p v-if="actual" class="creative-presets-actual">最近生成实际采用：{{actual.name||actual.id||'创作预设'}}<template v-if="actual.version"> · 版本 {{actual.version}}</template><template v-if="actual.skills?.length"> · {{actual.skills.map(skill=>skill.name).join('、')}}</template>。</p>
  </div>
 </details>
</template>
