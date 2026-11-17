<script setup>
import {computed,inject,onBeforeUnmount,ref,watch} from 'vue';
import Modal from './Modal.vue';
import I from './Icon.vue';
import {call,mediaUrl} from '../api';

const props=defineProps({avatar:{type:Object,required:true}});
const emit=defineEmits(['close','saved']);
const {state,draft:d,busy,workflowLocked,save,refresh,notify,act}=inject('studio');
const taskId=d.value.id,avatarId=props.avatar?.id;
const look=ref('natural'),background=ref('business-studio'),beautyStrength=ref(12),instruction=ref(''),backgroundPlan=ref(null),backgroundCandidateId=ref(''),generatedBackground=ref(null),backgroundChosenAssetId=ref(''),backgroundPlanning=ref(false),backgroundGenerating=ref(false),error=ref(''),working=ref(false),selecting=ref(false),generated=ref(null),runId=ref(''),stopping=ref(false),stopRequested=ref(false);
const backgroundAspect=ref(''),aspectOptions=['9:16','16:9','1:1','4:3','3:4'];
let pollTimer,alive=true;
// 参数变化后撤下旧预览，避免把上一组效果误认为本次选择。
watch([look,background,beautyStrength,backgroundChosenAssetId],()=>{generated.value=null;error.value='';},{flush:'sync'});
watch([instruction,backgroundCandidateId],()=>{backgroundChosenAssetId.value='';generated.value=null;if(generatedBackground.value)generatedBackground.value={...generatedBackground.value,stale:true};},{flush:'sync'});
watch(backgroundAspect,()=>{backgroundPlan.value=null;backgroundCandidateId.value='';backgroundChosenAssetId.value='';generated.value=null;},{flush:'sync'});
function invalidateSource(){backgroundPlan.value=null;backgroundChosenAssetId.value='';if(generatedBackground.value)generatedBackground.value={...generatedBackground.value,stale:true};generated.value=null;}
watch([()=>d.value.id,()=>d.value.finalText,()=>d.value.confirmed],invalidateSource,{flush:'sync'});
watch(()=>d.value.video.avatarId,()=>{if(!selecting.value)invalidateSource();},{flush:'sync'});
watch(()=>d.value.video.aspect,()=>{backgroundAspect.value='';invalidateSource();},{flush:'sync'});
watch(background,()=>{if(background.value!=='content-image'){backgroundPlan.value=null;backgroundCandidateId.value='';generatedBackground.value=null;instruction.value='';}},{flush:'sync'});
const activeRun=computed(()=>state.value?.runs?.find(run=>run.id===runId.value||run.draftId===taskId&&['avatar-optimize','avatar-background'].includes(run.type)&&['running','queued','unknown'].includes(run.status))||null);
const otherActive=computed(()=>state.value.runs.some(run=>run.draftId===taskId&&['running','queued','unknown'].includes(run.status)));
const locked=computed(()=>working.value||backgroundPlanning.value||backgroundGenerating.value||selecting.value||!!busy.value||workflowLocked.value||stopping.value||otherActive.value||d.value.id!==taskId||d.value.video.avatarId!==avatarId);
const hasSource=computed(()=>!!props.avatar?.assetId&&state.value.assets.some(asset=>asset.id===props.avatar.assetId));
const selectedBackground=computed(()=>generatedBackground.value?.stale||generatedBackground.value?.asset?.id!==backgroundChosenAssetId.value?null:generatedBackground.value);
const unknownBackground=computed(()=>state.value.runs.find(run=>run.draftId===taskId&&run.type==='avatar-background'&&run.status==='unknown'));
const canQueryBackground=computed(()=>!!unknownBackground.value&&!working.value&&!backgroundGenerating.value&&!backgroundPlanning.value&&!busy.value&&!workflowLocked.value&&d.value.id===taskId&&d.value.video.avatarId===avatarId);
// 成功记录仅恢复候选预览，不能替用户自动选择背景。
const backgroundHistory=computed(()=>{
 const seen=new Set();return state.value.runs.filter(run=>run.type==='avatar-background'&&run.status==='succeeded'&&run.draftId===taskId).flatMap(run=>{
  const output=run.output,source=output?.source,asset=state.value.assets.find(item=>item.id===output?.asset?.id&&item.type==='image');if(!asset||!source||source.avatarId!==avatarId||source.draftId!==taskId||seen.has(asset.id))return [];seen.add(asset.id);
  const stale=!!output.stale||!d.value.confirmed||source.finalText!==d.value.finalText;return [{id:run.id,asset,output:{...output,stale},label:output.candidate?.label||asset.name||'文案背景',createdAt:run.endedAt||run.createdAt,stale,instruction:run.parameters?.instruction||''}];
 });
});

function startPolling(){
 clearInterval(pollTimer);pollTimer=setInterval(async()=>{try{await refresh();const run=activeRun.value;if(run)runId.value=run.id;}catch{ /* 刷新失败由主工作台继续处理 */ }},800);
}
function stopPolling(){clearInterval(pollTimer);pollTimer=undefined;}
async function stop(){
 if(stopping.value||stopRequested.value)return;
 stopping.value=true;
 try{
  // 点击停止时主动读取已落盘任务，不等下一次轮询才能取得执行记录。
  if(!activeRun.value)await refresh();
  const run=activeRun.value;if(!run)throw Error('尚未取得本次执行记录，请稍候重试');
  await call('cancelRun',{id:run.id});stopRequested.value=true;await refresh();
 }catch(e){error.value='停止优化失败：'+e.message;}finally{stopping.value=false;}
}
async function optimize(){
 if(locked.value||!hasSource.value)return;if(look.value==='original'&&background.value==='original'&&Number(beautyStrength.value)===0){error.value='请至少选择画面处理、背景替换或自然美颜';return;}if(background.value==='content-image'&&!selectedBackground.value){error.value='请先生成并选用一张当前文案的背景候选';return;}error.value='';stopRequested.value=false;runId.value='';working.value=true;startPolling();
 try{
  const sourceAtSubmit={text:d.value.finalText,confirmed:d.value.confirmed};const payload={id:taskId,avatarId,look:look.value,background:background.value,beautyStrength:Number(beautyStrength.value)||0};if(background.value==='content-image'){payload.backgroundAssetId=selectedBackground.value.asset.id;payload.sourceHash=selectedBackground.value.source.sourceHash;}
  const result=await act('优化形象',async()=>{try{return await call('avatarOptimize',payload);}catch(e){error.value=e.message;throw e;}});
  if(!result){if(!error.value)error.value='形象优化失败，原形象保持不变';return;}
  if(!result.avatar?.id||!result.asset?.id)throw new Error('优化服务未返回新的形象和素材记录，原形象保持不变');
  if(d.value.id!==taskId||d.value.video.avatarId!==avatarId||d.value.finalText!==sourceAtSubmit.text||d.value.confirmed!==sourceAtSubmit.confirmed){error.value='当前文案、任务或人物已变化，副本保存在形象库，未选用';return;}
  if(alive)generated.value=result;
 }catch(e){error.value=e.message;}finally{working.value=false;stopPolling();}
}
async function planBackground(){
 if(locked.value||background.value!=='content-image')return;error.value='';backgroundPlanning.value=true;backgroundPlan.value=null;backgroundCandidateId.value='';generatedBackground.value=null;
 try{await save();if(d.value.id!==taskId||d.value.video.avatarId!==avatarId)throw Error('当前任务或人物已变化，请重新打开优化形象');const aspect=await resolveBackgroundAspect();const result=await call('planAvatarBackground',{id:taskId,avatarId,aspect});if(!result?.source?.sourceHash||!Array.isArray(result.candidates)||!result.candidates.length)throw Error('文案背景方案为空，请确认最终文案后重试');backgroundPlan.value={...result,aspect};backgroundCandidateId.value=result.candidates[0].id;}
 catch(e){error.value=e.message;}finally{backgroundPlanning.value=false;}
}
async function generateBackground(){
 if(locked.value||!backgroundPlan.value||!backgroundCandidateId.value)return;error.value='';stopRequested.value=false;runId.value='';backgroundGenerating.value=true;startPolling();
 try{const payload={id:taskId,avatarId,candidateId:backgroundCandidateId.value,sourceHash:backgroundPlan.value.source.sourceHash,aspect:backgroundPlan.value.aspect,instruction:instruction.value};const result=await act('生成文案背景',async()=>{try{return await call('generateAvatarBackground',payload);}catch(e){error.value=e.message;throw e;}});if(!result){if(!error.value)error.value='背景生成未完成，请检查执行记录';return;}receiveBackground(result);}
 catch(e){error.value=e.message;}finally{backgroundGenerating.value=false;stopPolling();}
}
function receiveBackground(result){if(!result?.asset?.id||!result.source?.sourceHash)throw Error('背景服务未返回真实图片素材与文案来源');const changed=d.value.id!==taskId||d.value.video.avatarId!==avatarId||result.source.draftId!==taskId||result.source.avatarId!==avatarId||!d.value.confirmed||d.value.finalText!==result.source.finalText;generatedBackground.value={...result,stale:!!result.stale||changed};backgroundChosenAssetId.value='';generated.value=null;if(generatedBackground.value.stale)error.value='文案或人物已变化，这张背景不能选用';}
function selectBackground(){if(generatedBackground.value?.stale){error.value='这张背景基于旧文案或旧人物，不能选用';return;}if(generatedBackground.value?.asset?.id){backgroundChosenAssetId.value=generatedBackground.value.asset.id;error.value='';}}
async function resolveBackgroundAspect(){
 if(aspectOptions.includes(backgroundAspect.value))return backgroundAspect.value;
 if(aspectOptions.includes(d.value.video.aspect)){backgroundAspect.value=d.value.video.aspect;return backgroundAspect.value;}
 let size;try{size=await call('coverSourceSize',{assetId:props.avatar.assetId});}catch(e){throw Error('无法读取原人物视频的显示尺寸，请手动选择背景比例：'+e.message);}
 const width=Number(size?.width),height=Number(size?.height),ratio=width/height,match=aspectOptions.find(value=>{const [w,h]=value.split(':').map(Number);return Math.abs(ratio-w/h)/(w/h)<.025;});
 if(!(width>0&&height>0)||!match)throw Error('原人物视频的比例无法直接匹配，请根据当前视频设置手动选择背景比例');backgroundAspect.value=match;return match;
}
function previewHistory(row){if(locked.value||row.stale)return;instruction.value=row.instruction;backgroundCandidateId.value=row.output.candidate?.id||'';receiveBackground(row.output);error.value='';}
async function queryBackground(){if(!canQueryBackground.value)return;const id=unknownBackground.value.id;backgroundGenerating.value=true;runId.value=id;error.value='';startPolling();try{const result=await call('queryAvatarBackground',{id:taskId,runId:id});receiveBackground(result);}catch(e){error.value=e.message;}finally{backgroundGenerating.value=false;stopPolling();await refresh();}}
async function useGenerated(){
 if(locked.value||!generated.value)return;
 if(!alive||d.value.id!==taskId||d.value.video.mode!=='single'||d.value.video.avatarId!==avatarId){error.value='当前任务或形象选择已变化，副本仍保存在形象库，未覆盖当前选择';return;}
 const result=generated.value;selecting.value=true;error.value='';
 try{d.value.video.avatarId=result.avatar.id;await save();await refresh();notify('已选用优化形象副本，请重新生成视频并检查效果','success');emit('saved',result.avatar);}
 catch(e){if(d.value.id===taskId&&d.value.video.avatarId===result.avatar.id)d.value.video.avatarId=avatarId;error.value='选用失败：'+e.message+'；优化副本仍保存在形象库';}
 finally{selecting.value=false;}
}
function close(){if(!working.value&&!backgroundPlanning.value&&!backgroundGenerating.value&&!stopping.value&&!selecting.value)emit('close');}
onBeforeUnmount(()=>{alive=false;stopPolling();});
</script>

<template>
 <Modal title="优化形象" variant="avatar-optimize" :close-disabled="working||backgroundPlanning||backgroundGenerating||stopping||selecting" @close="close">
 <div class="avatar-optimize-body">
   <div class="avatar-optimize-source"><div class="avatar-optimize-preview"><img v-if="avatar.posterId&&state.assets.some(asset=>asset.id===avatar.posterId)" :src="mediaUrl(avatar.posterId)" alt=""/><I v-else name="User" :size="42"/></div><div><strong>{{avatar.name}}</strong><p>以当前形象为基础生成副本</p></div></div>
   <p class="avatar-optimize-notice">保留原片中的本人、衣着和动作，只处理画面与背景，不生成新人物。原形象保留，已有成片需重新生成。背景分离边缘和画面细节仍需预览确认。</p>
   <fieldset><legend>画面处理</legend><label class="avatar-optimize-choice"><input v-model="look" type="radio" value="natural" :disabled="locked"/><span><strong>自然调色与轻度增强</strong><small>自然调色、轻度降噪和锐化，尽量保持原始肤色。</small></span></label><label class="avatar-optimize-choice"><input v-model="look" type="radio" value="original" :disabled="locked"/><span><strong>保留原始画面</strong><small>不额外调整画面色彩和清晰度。</small></span></label></fieldset>
   <fieldset><legend>背景</legend><label class="avatar-optimize-choice"><input v-model="background" type="radio" value="business-studio" :disabled="locked"/><span><strong>简洁商务演播室</strong><small>使用干净、克制的商务演播室背景。</small></span></label><label class="avatar-optimize-choice"><input v-model="background" type="radio" value="content-image" :disabled="locked"/><span><strong>跟随当前文案 · 自然写实场景</strong><small>依据已确认的最终文案生成无人背景，先预览再合成人物。</small></span></label><label class="avatar-optimize-choice"><input v-model="background" type="radio" value="original" :disabled="locked"/><span><strong>保留原背景</strong><small>仅处理画面，不替换原有背景。</small></span></label></fieldset>
   <section v-if="background==='content-image'" class="avatar-background-editor" aria-label="文案背景设置">
    <label class="avatar-background-aspect">背景画面比例<select v-model="backgroundAspect" :disabled="locked" aria-label="背景画面比例"><option value="">跟随当前视频设置或原片显示尺寸</option><option v-for="aspect in aspectOptions" :key="aspect" :value="aspect">{{aspect}}</option></select><small>优先使用当前视频比例，否则读取原片旋转后的真实显示尺寸；无法确认时请手动选择。</small></label>
    <div class="avatar-background-actions"><button type="button" :disabled="locked" @click="planBackground">{{backgroundPlanning?'正在读取文案…':'获取背景方案'}}</button><small v-if="backgroundPlan">已根据当前确认文案生成 {{backgroundPlan.candidates.length}} 个方案，请选择后生成真实背景图。</small><small v-if="backgroundPlan" class="avatar-background-source">关联文案：{{backgroundPlan.source.finalText.slice(0,120)}}{{backgroundPlan.source.finalText.length>120?'…':''}}</small><small>使用设置中的本地 ComfyUI 图像模型。背景中的人物、文字与空间关系仍需逐张检查。</small></div>
    <div v-if="backgroundPlan" class="avatar-background-candidates"><label v-for="candidate in backgroundPlan.candidates" :key="candidate.id" class="avatar-background-candidate"><input v-model="backgroundCandidateId" type="radio" :value="candidate.id" :disabled="locked"/><span><strong>{{candidate.label}}</strong><small>{{candidate.prompt}}</small></span></label></div>
    <label class="avatar-background-instruction">背景补充要求（可选，4000字以内）<textarea v-model="instruction" maxlength="4000" :disabled="locked" placeholder="例如：自然写实的卫星地面站，背景保持干净，不出现人物、文字和品牌标识。"></textarea><small>{{instruction.length}} / 4000</small></label>
    <button type="button" class="primary" :disabled="locked||!backgroundCandidateId" @click="generateBackground">{{backgroundGenerating?'背景生成中…':'生成真实背景图'}}</button>
    <button v-if="unknownBackground" type="button" :disabled="!canQueryBackground" @click="queryBackground">查询上次背景生成结果</button>
    <section v-if="backgroundHistory.length" class="avatar-background-history" aria-label="历史背景候选"><strong>已生成的背景</strong><small>重新打开后可继续预览，选用前会核对当前文案与人物。</small><div class="avatar-background-history-grid"><button v-for="row in backgroundHistory" :key="row.id" type="button" :disabled="locked||row.stale" :aria-label="'预览背景：'+row.label" @click="previewHistory(row)"><img :src="mediaUrl(row.asset.id)" alt=""/><span>{{row.label}}</span><small>{{row.stale?'文案已变化，不能选用':'点击预览，再明确选用'}}</small></button></div></section>
    <div v-if="generatedBackground" class="avatar-background-result"><img :src="mediaUrl(generatedBackground.asset.id)" alt="文案背景候选"/><p>{{generatedBackground.stale?'文案或人物已变化，候选已失效':selectedBackground?'这张背景已选中，接下来生成优化副本':'背景候选已生成，请确认画面后选用'}}</p><button type="button" :disabled="locked||generatedBackground.stale||!!selectedBackground" @click="selectBackground">{{generatedBackground.stale?'候选已失效':selectedBackground?'已选用这张背景':'选用这张背景'}}</button></div>
   </section>
   <fieldset><legend>自然美颜</legend><label class="avatar-beauty-toggle"><span>轻度自然美颜：{{beautyStrength}} / 30</span><input v-model.number="beautyStrength" type="range" min="0" max="30" step="1" :disabled="locked"/></label><small class="avatar-beauty-help">仅做保守的肤部平滑与轻微亮度调整，保留五官、肤质、衣着和本人特征；设为0可关闭。</small></fieldset>
   <p v-if="error" class="avatar-optimize-error" role="alert">{{error}}</p>
   <p v-if="working||backgroundGenerating" class="avatar-optimize-progress" role="status" aria-live="polite"><I name="LoaderCircle" class="spin" :size="16"/>{{stopRequested?'已请求停止，正在等待处理结束…':activeRun?(backgroundGenerating?'正在生成背景':'正在处理形象')+' · '+Math.round(Number(activeRun.progress)||0)+'%':backgroundGenerating?'正在准备背景生成…':'正在准备形象优化…'}}</p>
   <section v-if="generated" class="avatar-optimize-result" aria-label="优化副本预览"><strong>{{generated.avatar.name}}</strong><video :key="generated.asset.id" :src="mediaUrl(generated.asset.id)" controls playsinline preload="metadata" aria-label="优化后的形象视频"/><p>请检查肤色、头发边缘、手部与背景，再决定是否选用。</p></section>
  </div>
  <template #footer><button v-if="working||backgroundGenerating" class="avatar-optimize-stop" :disabled="stopping||stopRequested" @click="stop"><I name="Square" :size="14"/>{{stopping||stopRequested?'正在停止…':'停止处理'}}</button><button :disabled="working||backgroundPlanning||backgroundGenerating||stopping||selecting" @click="close">{{generated?'关闭':'取消'}}</button><button :class="{primary:!generated}" :disabled="locked||!hasSource" @click="optimize">{{working?'优化中…':generated?'重新优化':'生成优化副本'}}</button><button v-if="generated" class="primary" :disabled="locked" @click="useGenerated">{{selecting?'保存中…':'选用此副本'}}</button></template>
 </Modal>
</template>
