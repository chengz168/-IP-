<script setup>
import {computed,inject,nextTick,onBeforeUnmount,ref,watch} from 'vue';
import I from './Icon.vue';
import AssetPicker from './AssetPicker.vue';
import Modal from './Modal.vue';
import StoryModelSettings from './StoryModelSettings.vue';
import CreativePresets from './CreativePresets.vue';
import {localizeShotView,localizeAssetView,assetTranslationSource,needsTranslation} from '../../server/shot-localization-view.mjs';
import {call,mediaUrl} from '../api';
import {storyEditorValue,upstreamStoryText,storyShotProblems,storyPrimaryReferenceId,createStoryShot,createStoryAsset,storyKindLabel,storyUiDrafts,storyEpisodeFingerprint,storyEpisodeProgress,storyEpisodeAssets,storyVersionConflict,storyScopedSelection,storyAssetNeedsGeneration,storyBatchStatusLabel,storyBatchSummary} from '../story-ui.mjs';
import '../story-studio.css';
import '../shot-localization.css';

const props=defineProps({productMode:{type:Boolean,default:false}});
const {state,draft,busy,workflowLocked,act,refresh,notify,navigate,registerDraftFlusher}=inject('studio');
const taskId=draft.value.id,cached=storyUiDrafts.get(taskId),initial=storyEditorValue(draft.value);
const story=ref(cached?.story||initial),tab=ref(props.productMode?'videos':'episodes'),episodeId=ref(''),shotId=ref(''),assetId=ref(''),kind=ref('all'),error=ref(cached?'已恢复上次尚未保存的编辑，请保存后继续。':''),pending=ref(false),saving=ref(false),picker=ref(null),preview=ref(null),instructions=ref({}),inputFingerprint=ref('');
const baseline=ref(cached?.baseline||JSON.stringify(initial));
const rootElement=ref(null),modelSettings=ref(null),assetScope=ref('episode');
const checkedShots=ref([]),checkedAssets=ref([]),batchStopping=ref(false),batchStopRunId=ref('');
const shotDesignCandidate=ref(null),shotDesignInstruction=ref('');
const shotDesignFields=[['visual','画面内容'],['action','主体动作'],['camera','景别与运镜'],['sound','镜头声音']];
const shotDesignKeys=[...shotDesignFields.map(([key])=>key),'videoPrompt'];
const translationStatus=ref('');
function viewShot(item){
  return localizeShotView(item,draft.value.artifacts?.shotTranslations||{});
}
const shotDisplay=computed(()=>viewShot(shot.value));
function setDesignField(key,value){if(!locked.value&&shot.value&&!shotDisplay.value.translated)shot.value[key]=value;}
function editChineseTranslation(){
  if(locked.value||!shotDisplay.value.translated)return;
  const display=shotDisplay.value;
  // 用户明确开始编辑时才把译稿写入镜头设计，继续由原保存逻辑使旧媒体失效。
  for(const [key] of shotDesignFields)shot.value[key]=display[key];
  translationStatus.value='已将中文译稿转为可编辑设计，保存会让受影响的媒体选用失效，历史候选保留。';
}
async function translateDesign(scope){
  if(locked.value||dirty.value||!episode.value||!shot.value)return;
  translationStatus.value='';
  const result=await run('translateStoryDesign',{episodeId:episode.value.id,...(scope==='shot'?{shotId:shot.value.id}:{})},scope==='shot'?'转换当前镜头中文译稿':'转换当前集中文译稿');
  if(result)translationStatus.value='已保存 '+result.translated+' 个镜头中文译稿，跳过 '+result.skipped+' 个无需重复转换的镜头。原镜头和已生成媒体保持不变，请核对译意。';
}

let shotDesignVersion=0,shotDesignRequest=0;
let saveRequest,saveTimer,fingerprintVersion=0;
const dirty=computed(()=>JSON.stringify(story.value)!==baseline.value);
const remoteStory=computed(()=>state.value?.drafts.find(item=>item.id===draft.value.id)?.story||draft.value.story);
const activeRun=computed(()=>state.value?.runs.some(run=>run.draftId===draft.value.id&&(String(run.type).startsWith('story-')||['product-shot-design','story-translation'].includes(run.type))&&['running','queued','unknown'].includes(run.status)));
const locked=computed(()=>!!busy.value||workflowLocked.value||pending.value||saving.value||activeRun.value);
const episode=computed(()=>story.value.episodes.find(item=>item.id===episodeId.value)||story.value.episodes[0]);
const shot=computed(()=>episode.value?.shots.find(item=>item.id===shotId.value)||episode.value?.shots[0]);
const episodeAssets=computed(()=>storyEpisodeAssets(story.value,episode.value));
const asset=computed(()=>visibleAssets.value.find(item=>item.id===assetId.value)||visibleAssets.value[0]);
const assetDisplay=computed(()=>localizeAssetView(asset.value,draft.value.artifacts?.shotTranslations||{}));
const assetTranslationStatus=ref('');
const assetNeedsTranslation=computed(()=>!!asset.value&&[asset.value.description,asset.value.prompt].some(value=>needsTranslation(value)));
function setAssetDesignField(key,value){if(!locked.value&&asset.value&&!assetDisplay.value.translated&&['description','prompt'].includes(key))asset.value[key]=value;}
function editAssetChineseTranslation(){
  if(locked.value||!asset.value||!assetDisplay.value.translated)return;
  const display=assetDisplay.value;
  // 只有用户明确选用译稿编辑时才修改资产，保存继续沿用原媒体失效规则。
  asset.value.description=display.description;asset.value.prompt=display.prompt;
  assetTranslationStatus.value='已将中文译稿转为可编辑设定。保存后旧资产图与引用镜头的选用会按版本规则失效，历史候选保留。';
}
async function translateAssetDesign(){
  if(locked.value||dirty.value||!asset.value)return;
  const source=JSON.stringify(assetTranslationSource(asset.value)),id=draft.value.id,targetId=asset.value.id;
  assetTranslationStatus.value='';
  const result=await run('translateStoryDesign',{assetId:targetId},'转换当前资产中文译稿');
  if(result&&draft.value.id===id&&asset.value?.id===targetId&&JSON.stringify(assetTranslationSource(asset.value))===source)assetTranslationStatus.value=result.translated?'已保存当前资产中文阅读译稿，原提示词与已选图片保持不变，请核对译意。':'当前资产已有有效译稿，或无需转换；原提示词与已选图片保持不变。';
}
const visibleAssets=computed(()=>(assetScope.value==='episode'?episodeAssets.value:story.value.assets).filter(item=>kind.value==='all'||item.kind===kind.value));
const selectedShotIds=computed(()=>storyScopedSelection(checkedShots.value,episode.value?.shots));
const selectedAssetIds=computed(()=>storyScopedSelection(checkedAssets.value,visibleAssets.value));
const recentBatch=computed(()=>state.value.runs.find(item=>item.draftId===draft.value.id&&item.type==='story-image'&&Array.isArray(item.parameters?.batchAssetIds))||null);
const batchSummary=computed(()=>storyBatchSummary(recentBatch.value));
const batchRecovering=ref(false);
const canConfirmBatchLost=computed(()=>recentBatch.value?.status==='unknown'&&['story-comfy-image-v1','story-comfy-video-v1'].includes(recentBatch.value?.remote?.kind));
async function confirmBatchLost(){
  if(batchRecovering.value||busy.value||pending.value||saving.value||workflowLocked.value)return;
  const runId=recentBatch.value?.id;if(!runId)return;
  batchRecovering.value=true;error.value='';
  try{await persist();const result=await call('confirmStoryLost',{runId});await refresh();notify(result.message,'success');}
  catch(e){error.value=e.message;await refresh().catch(()=>{});}
  finally{batchRecovering.value=false;}
}
const upstream=computed(()=>upstreamStoryText(draft.value));
const sourceConfirmed=computed(()=>props.productMode?draft.value.confirmed&&!!draft.value.finalText?.trim():story.value.sourceMode==='custom'||draft.value.confirmed&&!!draft.value.finalText?.trim());
const sourceChanged=computed(()=>props.productMode?(!sourceConfirmed.value||story.value.sourceText!==draft.value.finalText||JSON.stringify(draft.value.product)!==JSON.stringify(story.value.productIntroduction?.productSnapshot)||story.value.productIntroduction?.audioId!==draft.value.voice.audioId):!sourceConfirmed.value||story.value.episodes.length>0&&((story.value.sourceMode!=='custom'&&story.value.sourceText!==upstream.value)||story.value.episodesSourceHash!==inputFingerprint.value));
const planningReady=computed(()=>sourceConfirmed.value&&story.value.episodes.length>0&&!sourceChanged.value);
const issues=computed(()=>storyShotProblems(shot.value,story.value.assets));
const localImage=computed(()=>(state.value.settings.provider.storyImageProtocol||'comfy')==='comfy');
const textOnlyImage=computed(()=>localImage.value&&state.value.settings.provider.storyImageArchitecture==='z-image-turbo');
const imageIssues=computed(()=>props.productMode?[]:storyShotProblems(shot.value,story.value.assets,{imageProtocol:localImage.value?'comfy':'compatible',imageArchitecture:state.value.settings.provider.storyImageArchitecture}));
const boundAssets=computed(()=>story.value.assets.filter(item=>shot.value?.assetIds.includes(item.id)));
const primaryReference=computed({get:()=>storyPrimaryReferenceId(shot.value),set:value=>{if(shot.value&&!locked.value)shot.value.primaryReferenceAssetId=value;}});
const videoIssues=computed(()=>storyShotProblems(shot.value,story.value.assets,{video:true}));
const narrationMissing=computed(()=>story.value.narrationMode==='upstream'&&!episode.value?.narrationAssetId&&(story.value.episodes.length>1||!draft.value.voice.audioId));
const progress=computed(()=>storyEpisodeProgress(story.value,episode.value,{media:state.value.assets,sourceChanged:sourceChanged.value,narrationMissing:narrationMissing.value}));
const composeReason=computed(()=>!episode.value?.shots.length?'请先拆分镜头':progress.value.stages.slice(1,4).some(item=>!item.done)?'请先确认当前集引用资产、各镜头首帧和视频的有效版本':narrationMissing.value?'请选择当前集旁白音频后再合成':'');
const versionConflict=computed(()=>storyVersionConflict(error.value));
const currentEpisodeLabel=computed(()=>episode.value?episodeName(episode.value,story.value.episodes.findIndex(item=>item.id===episode.value.id)):'尚未拆集');
const episodeSeconds=computed(()=>episode.value?.shots.reduce((sum,item)=>sum+(Number(item.duration)||0),0)||0);
const effectiveNarrationId=computed(()=>story.value.narrationMode==='upstream'?(episode.value?.narrationAssetId||(story.value.episodes.length===1?draft.value.voice?.audioId:'')): '');
const selectedNarration=computed(()=>effectiveNarrationId.value?state.value.assets.find(item=>item.id===effectiveNarrationId.value&&item.type==='audio'):undefined);
const selectedNarrationSource=computed(()=>!selectedNarration.value?'':episode.value?.narrationAssetId?(episode.value.narrationAssetId===draft.value.voice?.audioId?'第三步配音（已指定）':'本集指定音频'):'第三步配音（单集默认）');
const upstreamTimingVisible=computed(()=>!props.productMode&&Number(story.value.episodeCount)===1&&story.value.episodes.length<=1&&story.value.narrationMode==='upstream');
const upstreamNarration=computed(()=>state.value.assets.find(item=>item.id===draft.value.voice?.audioId&&item.type==='audio'));
const upstreamNarrationDuration=computed(()=>{
  const duration=upstreamNarration.value?.duration;
  return typeof duration==='number'&&Number.isFinite(duration)&&duration>0?duration:null;
});
const upstreamTimingProblem=computed(()=>{
  if(!draft.value.voice?.audioId)return '请先到第三步生成或导入配音，再按配音设置计划时长。';
  if(!upstreamNarration.value)return '第三步配音不在当前音频素材中，请重新选择或导入配音。';
  if(upstreamNarrationDuration.value===null)return '第三步配音尚无可靠时长，请重新导入或生成音频后再设置。';
  if(upstreamNarrationDuration.value<4)return '当前配音不足4秒，短于动态镜头的最短时长。请补充文案并重新生成至少4秒的配音，再规划动态镜头。';
  if(upstreamNarrationDuration.value>600)return '第三步配音超过每集600秒上限。请缩短文案后重新配音，或改为多集并逐集指定旁白音频。';
  return '';
});
const plannedDurationLabel=computed(()=>Number.isFinite(story.value.episodeDuration)?story.value.episodeDuration.toFixed(2)+' 秒':'尚未有效设置');
const hasIndependentNarration=computed(()=>!!episode.value?.narrationAssetId&&episode.value.narrationAssetId!==draft.value.voice?.audioId);
const canUseUpstreamDuration=computed(()=>upstreamTimingVisible.value&&!locked.value&&!upstreamTimingProblem.value&&story.value.episodeDuration!==Number(upstreamNarrationDuration.value.toFixed(2)));
function useUpstreamDuration(){
  if(!canUseUpstreamDuration.value)return;
  // 只更新拆集计划，不改音频或选用新媒体；保存后沿用原指纹与版本失效规则。
  story.value.episodeDuration=Number(upstreamNarrationDuration.value.toFixed(2));
  notify('每集参考时长已按第三步配音设为 '+story.value.episodeDuration.toFixed(2)+' 秒。'+(story.value.episodes.length?'请按当前要求重新拆集，再重新拆分镜头。':'接下来按此时长拆集、拆分镜头。'));
}
const instructionKey=computed(()=>tab.value==='assets'?asset.value?.id:shot.value?.id);
const correction=computed({get:()=>instructions.value[instructionKey.value]||'',set:value=>{if(instructionKey.value)instructions.value[instructionKey.value]=value;}});
const shotDesignContext=computed(()=>JSON.stringify({id:draft.value.id,episodeId:episode.value?.id,shotId:shot.value?.id,story:story.value,product:draft.value.product,finalText:draft.value.finalText,confirmed:draft.value.confirmed,audioId:draft.value.voice?.audioId}));
watch(shotDesignContext,()=>{shotDesignVersion++;shotDesignCandidate.value=null;},{flush:'sync'});
watch(shotDesignInstruction,()=>{shotDesignVersion++;shotDesignCandidate.value=null;},{flush:'sync'});
watch([()=>draft.value.id,()=>episode.value?.id,()=>shot.value?.id],()=>{shotDesignInstruction.value='';translationStatus.value='';},{flush:'sync'});

async function proposeShotDesign(){
  if(!props.productMode||locked.value||!shot.value||sourceChanged.value)return;
  const request=++shotDesignRequest,scope={id:draft.value.id,...shotPayload()},instruction=shotDesignInstruction.value.trim();
  pending.value=true;error.value='';shotDesignCandidate.value=null;let failure;
  try{
    const result=await act('优化当前产品镜头为中文',async()=>{try{
      await persist();
      if(draft.value.id!==scope.id||episode.value?.id!==scope.episodeId||shot.value?.id!==scope.shotId)throw Error('当前镜头已切换，请在需要优化的镜头重新操作');
      const context=shotDesignContext.value,version=shotDesignVersion;
      const proposal=await call('proposeProductShotDesign',{...scope,instruction});
      return{proposal,context,version};
    }catch(e){failure=e;throw e;}});
    if(!result)throw failure||Error('镜头优化未完成，请检查任务执行记录');
    if(request!==shotDesignRequest||result.version!==shotDesignVersion||result.context!==shotDesignContext.value){error.value='镜头或来源已变化，本次优化建议已作废，请重新优化';return;}
    const proposal=result.proposal;
    if(proposal?.stale||Number(proposal?.revision)!==Number(story.value.revision))throw Error('镜头版本已变化，本次优化建议已作废，请重新优化');
    if(!proposal?.inputHash||!proposal?.design||shotDesignKeys.some(key=>typeof proposal.design[key]!=='string'||!proposal.design[key].trim()))throw Error('优化服务未返回完整镜头设计，请重试');
    shotDesignCandidate.value={...scope,context:result.context,version:result.version,inputHash:proposal.inputHash,revision:proposal.revision,design:proposal.design,before:Object.fromEntries(shotDesignFields.map(([key])=>[key,shotDisplay.value[key]||'']))};
  }catch(e){error.value=e.message;}finally{pending.value=false;}
}
function cancelShotDesign(){shotDesignRequest++;shotDesignCandidate.value=null;}
async function applyShotDesign(){
  const candidate=shotDesignCandidate.value;if(locked.value||!candidate)return;
  if(candidate.version!==shotDesignVersion||candidate.context!==shotDesignContext.value||candidate.id!==draft.value.id||candidate.episodeId!==episode.value?.id||candidate.shotId!==shot.value?.id||Number(candidate.revision)!==Number(story.value.revision)||sourceChanged.value){cancelShotDesign();error.value='镜头或来源已变化，不能应用旧建议，请重新优化';return;}
  // 只替换设计字段，旁白、事实、素材和时间轴继续由原流程管理。
  const design=candidate.design;cancelShotDesign();
  for(const key of shotDesignKeys)shot.value[key]=design[key];
  await run('saveStory',{},'应用并保存中文镜头设计');
}

function hydrate(value){story.value=storyEditorValue({...draft.value,story:value});baseline.value=JSON.stringify(story.value);storyUiDrafts.delete(taskId);}
watch(()=>draft.value.id,()=>{hydrate(draft.value.story);episodeId.value='';shotId.value='';assetId.value='';checkedShots.value=[];checkedAssets.value=[];batchStopRunId.value='';error.value='';});
watch(()=>remoteStory.value?.revision,()=>{if(!dirty.value&&!pending.value&&!saving.value)hydrate(remoteStory.value);});
watch(()=>episode.value?.id,()=>{shotId.value='';checkedShots.value=[];},{flush:'sync'});
watch([()=>draft.value.id,()=>asset.value?.id,()=>asset.value?.description,()=>asset.value?.prompt],()=>{assetTranslationStatus.value='';},{flush:'sync'});
watch(()=>[kind.value,visibleAssets.value.map(item=>item.id).join(',')],()=>{if(!visibleAssets.value.some(item=>item.id===assetId.value))assetId.value=visibleAssets.value[0]?.id||'';});
watch(()=>visibleAssets.value.map(item=>item.id).join(','),()=>{checkedAssets.value=storyScopedSelection(checkedAssets.value,visibleAssets.value);},{flush:'sync'});
watch(()=>episode.value?.shots.map(item=>item.id).join(','),()=>{checkedShots.value=storyScopedSelection(checkedShots.value,episode.value?.shots);},{flush:'sync'});
watch(()=>[story.value.sourceText,story.value.episodeCount,story.value.episodeDuration],async()=>{const version=++fingerprintVersion;try{const value=await storyEpisodeFingerprint(story.value);if(version===fingerprintVersion)inputFingerprint.value=value;}catch{inputFingerprint.value='';}},{immediate:true});
watch(()=>JSON.stringify(story.value),()=>{clearTimeout(saveTimer);if(!dirty.value)return;storyUiDrafts.set(taskId,{story:JSON.parse(JSON.stringify(story.value)),baseline:baseline.value});if(!pending.value&&!saving.value&&!busy.value&&!workflowLocked.value)saveTimer=setTimeout(()=>persist().catch(e=>{error.value=e.message;}),1000);});

async function persist(){
  clearTimeout(saveTimer);
  if(saveRequest)return saveRequest;
  if(!dirty.value&&remoteStory.value)return {story:story.value};
  const snapshot=JSON.parse(JSON.stringify(story.value));saving.value=true;
  saveRequest=(async()=>{try{const result=await call('saveStory',{id:taskId,story:snapshot,revision:snapshot.revision});if(!result?.story)throw Error('服务器未返回已保存的非口播创作版本');if(draft.value.id===taskId)hydrate(result.story);else storyUiDrafts.delete(taskId);await refresh();return result;}catch(e){storyUiDrafts.set(taskId,{story:JSON.parse(JSON.stringify(story.value)),baseline:baseline.value});throw e;}finally{saving.value=false;saveRequest=null;}})();
  return saveRequest;
}
const unregister=registerDraftFlusher?.(async()=>{if(draft.value.id===taskId&&(dirty.value||saveRequest))await persist();});
onBeforeUnmount(()=>{clearTimeout(saveTimer);if(dirty.value||saveRequest)persist().catch(e=>notify('非口播编辑未能保存，已保留待恢复草稿：'+e.message,'error')).finally(()=>unregister?.());else unregister?.();});
async function run(action,payload={},label='保存非口播创作',nextTab){
  if(locked.value)return;
  const taskId=draft.value.id;pending.value=true;error.value='';let failure;
  try{
    const result=await act(label,async()=>{try{await persist();if(action==='saveStory')return{story:story.value};return await call(action,{id:taskId,...payload});}catch(e){failure=e;throw e;}});
    if(!result)throw failure||Error('操作未完成，请检查任务执行记录');
    if(draft.value.id!==taskId)return;
    if(result.story)hydrate(result.story);else{await refresh();hydrate(remoteStory.value);}
    if(nextTab)tab.value=nextTab;
    return result;
  }catch(e){error.value=e.message;}finally{pending.value=false;}
}
async function splitEpisodes(){
  if(story.value.sourceMode!=='custom')story.value.sourceText=upstream.value;
  if(!sourceConfirmed.value){error.value='请先在第二步确认最终文案，或切换为独立剧本';return;}
  if(!story.value.sourceText.trim()){error.value='请先填写非口播剧本';return;}
  if(!Number.isInteger(Number(story.value.episodeCount))||Number(story.value.episodeCount)<1){error.value='集数必须为正整数';return;}
  await run('splitStoryEpisodes',{},'按指定集数拆分剧本','episodes');
}
function assetPayload(){return{assetId:asset.value.id};}
function shotPayload(){return{episodeId:episode.value.id,shotId:shot.value.id};}
function addShot(){if(locked.value||!episode.value)return;const item=createStoryShot();episode.value.shots.push(item);shotId.value=item.id;}
function moveShot(offset){const list=episode.value.shots,index=list.findIndex(item=>item.id===shot.value.id),target=index+offset;if(locked.value||target<0||target>=list.length)return;[list[index],list[target]]=[list[target],list[index]];}
function deleteShot(){if(locked.value||!shot.value)return;episode.value.shots=episode.value.shots.filter(item=>item.id!==shot.value.id);shotId.value='';}
function addAsset(){if(locked.value)return;const item=createStoryAsset(kind.value==='all'?'character':kind.value);story.value.assets.push(item);assetScope.value='all';assetId.value=item.id;}
function removeAsset(){if(locked.value||!asset.value)return;const target=asset.value;if(story.value.episodes.some(item=>item.shots.some(s=>s.assetIds.includes(target.id)))){error.value='此资产仍被镜头引用，请先取消对应镜头的绑定再删除';return;}story.value.assets=story.value.assets.filter(item=>item.id!==target.id);assetId.value='';}
function setBinding(id,selected){if(!shot.value||locked.value)return;shot.value.assetIds=selected?[...new Set([...shot.value.assetIds,id])]:shot.value.assetIds.filter(value=>value!==id);if(!shot.value.assetIds.includes(shot.value.primaryReferenceAssetId))shot.value.primaryReferenceAssetId='';}
function chooseImage(target){picker.value={kind:'image',title:target.assetId?'为资产选用已有图片':'为镜头选用已有构图图',target};}
async function picked(item){const choice=picker.value;picker.value=null;if(!choice)return;if(choice.kind==='audio'){if(episode.value?.id===choice.episodeId)episode.value.narrationAssetId=item.id;return;}await run('selectStoryImage',{...choice.target,imageId:item.id},'选用已有图片');}
function describeCandidate(item){return item.status==='stale'?'输入已变化，历史版本':item.id===asset.value?.selectedImageId||item.id===shot.value?.selectedImageId||item.id===shot.value?.selectedVideoId?'已确认选用':'待确认';}
function candidateInstruction(item){return item.instruction||item.prompt||'未记录提示词';}
function episodeName(item,index){return '第 '+(index+1)+' 集 · '+(item.title||'未命名');}
function loadServer(){if(locked.value||!versionConflict.value)return;hydrate(remoteStory.value);error.value='';notify('已载入服务器保存的非口播版本');}
async function goTo(target){
  if(!target||locked.value)return;const id=draft.value.id;
  if(target.episodeId&&story.value.episodes.some(item=>item.id===target.episodeId))episodeId.value=target.episodeId;
  tab.value=target.tab||tab.value;await nextTick();if(draft.value.id!==id)return;
  if(target.shotId&&episode.value?.shots.some(item=>item.id===target.shotId))shotId.value=target.shotId;
  if(target.assetId){kind.value='all';assetScope.value='episode';assetId.value=target.assetId;}
  await nextTick();if(draft.value.id!==id)return;
  const node=rootElement.value?.querySelector('[data-story-section="'+(target.section||'episode')+'"]');node?.scrollIntoView({block:'start',behavior:'auto'});node?.focus({preventScroll:true});
}
async function openModelSettings(){modelSettings.value?.open?.();await nextTick();rootElement.value?.querySelector('.story-model-settings')?.scrollIntoView({block:'start',behavior:'auto'});}
function toggleChecked(target,id,checked){if(locked.value)return;target.value=checked?[...new Set([...target.value,id])]:target.value.filter(value=>value!==id);}
function checkShot(id,checked){toggleChecked(checkedShots,id,checked);}
function checkAsset(id,checked){toggleChecked(checkedAssets,id,checked);}
async function viewAsset(id){
  assetId.value=id;await nextTick();
  // 窄窗口详情在列表下方，选中后直接定位，省去再次滚动寻找。
  if(rootElement.value?.getBoundingClientRect().width<=860){
    const editor=rootElement.value.querySelector('[data-story-section="asset"]');
    editor?.scrollIntoView({block:'start',behavior:'auto'});editor?.focus({preventScroll:true});
  }
}
function selectShots(all){if(!locked.value)checkedShots.value=all?(episode.value?.shots||[]).map(item=>item.id):[];}
function selectAssets(mode){if(locked.value)return;checkedAssets.value=mode==='all'?visibleAssets.value.map(item=>item.id):mode==='missing'?visibleAssets.value.filter(storyAssetNeedsGeneration).map(item=>item.id):[];}
async function extractAssets(mode='episode'){
  if(locked.value||!planningReady.value||!episode.value?.shots.length)return;
  const payload={episodeId:episode.value.id};if(mode==='current'){if(!shot.value)return;payload.shotId=shot.value.id;}else if(mode==='selected'){if(!selectedShotIds.value.length)return;payload.shotIds=[...selectedShotIds.value];}
  return run('extractStoryAssets',payload,mode==='current'?'提取当前镜头资产':mode==='selected'?'提取勾选镜头资产':'提取当前集资产','assets');
}
async function generateCheckedAssets(){
  if(locked.value||!planningReady.value||!selectedAssetIds.value.length)return;
  const assetIds=[...selectedAssetIds.value],corrections=Object.fromEntries(assetIds.map(id=>[id,instructions.value[id]||'']));batchStopRunId.value='';
  return run('generateStoryAssetImages',{assetIds,instructions:corrections},'批量生成资产图片');
}
async function stopBatch(){
  if(batchStopping.value)return;batchStopping.value=true;const id=draft.value.id;
  try{await refresh();if(draft.value.id!==id)return;const batch=recentBatch.value;if(!batch||!['running','queued'].includes(batch.status))throw Error('没有正在执行的批量任务，请查看原任务实际状态');if(batchStopRunId.value===batch.id)return;await call('cancelRun',{id:batch.id});batchStopRunId.value=batch.id;await refresh();}catch(e){error.value='停止批量生成失败：'+e.message;}finally{batchStopping.value=false;}
}
</script>

<template>
  <section ref="rootElement" class="story-studio" :aria-label="props.productMode?'产品介绍动态镜头工作台':'非口播创作工作台'" :aria-busy="locked">
    <header class="story-intro card"><div><span class="story-eyebrow">{{props.productMode?'产品介绍':'非口播创作'}}</span><h3>{{props.productMode?'产品介绍动态镜头':'非口播创作'}}</h3><p>{{props.productMode?'已关联商品脚本、确认文案、第三步旁白和商品素材；逐镜生成动态视频并确认后合成。':'从前文拆集与分镜，确认人物、场景和道具，再生成镜头视频。当前集成片可继续剪辑、制作封面和发布。'}}</p></div><button :disabled="locked" @click="navigate('settings')"><I name="Settings" :size="16"/>服务设置</button></header>
    <StoryModelSettings ref="modelSettings"/>
    <p v-if="activeRun&&!busy" class="story-notice warning" role="status">当前非口播任务仍在执行或有远程结果待确认，请保留原任务，避免重复生成。<button @click="navigate('tasks')">进入任务中心查看 / 查询</button></p>
    <div class="story-toolbar"><div class="segmented story-tabs" role="tablist" :aria-label="props.productMode?'产品介绍制作阶段':'非口播制作阶段'"><button v-if="!props.productMode" v-for="item in [['episodes','分集分镜'],['assets','资产图片']]" :key="item[0]" role="tab" :aria-selected="tab===item[0]" :class="{active:tab===item[0]}" @click="tab=item[0]">{{item[1]}}</button><button role="tab" :aria-selected="tab==='videos'" :class="{active:tab==='videos'}" @click="tab='videos'">{{props.productMode?'逐镜动态视频':'镜头视频'}}</button></div><span class="story-save-state">{{dirty?'有未保存修改':'版本 '+story.revision+' · 已保存'}}</span><button :disabled="locked||!dirty" @click="run('saveStory')"><I name="Save" :size="16"/>保存修改</button></div>

    <CreativePresets :stage="tab==='videos'?'video':'shots'" :context="props.productMode?{kind:'product'}:{}" :disabled="locked"/>
    <section v-if="episode?.shots.length" class="card shot-translation-panel" aria-label="历史镜头中文译稿">
      <div class="card-heading"><h4>镜头中文阅读</h4><span>{{shotDisplay.translated?'当前显示中文译稿 · 只读':'保留当前镜头设计'}}</span></div>
      <p>旧英文可以单镜或整集转换，译稿仅用于阅读，不改变原设计、素材与已选用视频。需要改变生成内容时，再明确进入编辑。</p>
      <div class="shot-translation-actions"><button :disabled="locked||dirty||!shot" @click="translateDesign('shot')">转换当前镜头为中文</button><button :disabled="locked||dirty" @click="translateDesign('episode')">转换当前集为中文</button><button v-if="shotDisplay.translated" :disabled="locked" @click="editChineseTranslation">用中文译稿编辑设计</button></div>
      <p v-if="dirty" class="story-help">请先保存现有修改，再转换中文译稿。</p>
      <p v-if="shotDisplay.translated" class="story-help">当前字段只读。点击“用中文译稿编辑设计”会把译稿写入设计，保存后受影响的首帧与视频选用将失效，历史候选保留。</p>
      <p v-if="translationStatus" class="story-help" role="status">{{translationStatus}}</p>
      <details v-if="shotDisplay.translated"><summary>核对原始镜头内容</summary><dl><template v-for="[key,label] in shotDesignFields" :key="key"><dt>{{label}}</dt><dd>{{shot[key]||'未填写'}}</dd></template></dl></details>
    </section>
    <div v-if="error" class="story-notice error" role="alert"><span>{{error}}<small v-if="versionConflict">载入服务器版本会替换当前编辑，请先保留需要的修改。</small></span><div class="story-error-actions"><button v-if="versionConflict" :disabled="locked" @click="loadServer">载入服务器版本</button><button v-else :disabled="locked" @click="openModelSettings">检查服务设置</button><button aria-label="关闭错误提示" @click="error=''">关闭</button></div></div>
    <p v-if="sourceChanged" class="story-notice warning" role="status">{{props.productMode?'商品资料、确认稿或声音已变化，请回上方重新核对产品介绍分镜。':!sourceConfirmed?'前文尚未确认，已暂停生成、合成和交接。请先回到第二步确认最终文案；前文变化后需要重新拆集。':'剧本、指定集数或每集参考时长已变化；当前分集仍来自旧版本。请检查来源并重新拆集，再继续生成。'}}</p>

    <section v-if="!props.productMode" class="card story-flow" aria-label="当前集制作进度">
      <div class="story-flow-context"><label>当前分集<select :value="episode?.id||''" :disabled="locked||!story.episodes.length" @change="episodeId=$event.target.value"><option v-if="!story.episodes.length" value="">尚未拆集</option><option v-for="(item,index) in story.episodes" :key="item.id" :value="item.id">{{episodeName(item,index)}}</option></select></label><p>仅统计本集引用资产与已明确选用的版本，生成候选后仍需预览确认。</p></div>
      <ol class="story-flow-stages"><li v-for="(stage,index) in progress.stages" :key="stage.id"><button :disabled="locked" :class="{complete:stage.done,current:progress.next.stage===stage.id}" :aria-current="progress.next.stage===stage.id?'step':undefined" @click="goTo(progress.next.stage===stage.id?progress.next.target:{tab:stage.tab,episodeId:episode?.id,section:stage.id==='compose'?'composition':stage.id==='assets'?'asset':stage.id==='frames'?'frame':stage.id==='videos'?'motion':'episode'})"><span>{{index+1}} · {{stage.label}}</span><small>{{sourceChanged?'来源待核对':stage.detail}}{{stage.done?stage.id==='shots'?' · 已拆分':stage.id==='compose'?' · 已合成':' · 已选用':''}}</small></button></li></ol>
      <div class="story-flow-next"><div><strong>{{currentEpisodeLabel}}</strong><p>{{activeRun?'当前有执行中或结果待确认的任务，请查询原任务。':progress.next.reason}}</p><small v-if="dirty">有未保存修改，操作前会保存并重新核对有效版本。</small></div><button v-if="activeRun" @click="navigate('tasks')">查看原任务</button><button v-else class="secondary" :disabled="locked" @click="goTo(progress.next.target)">{{progress.next.label}}<I name="ArrowRight" :size="16"/></button></div>
    </section>

    <section v-if="recentBatch&&!props.productMode" class="card story-batch-results" aria-label="资产批量生成进度">
      <div class="card-heading"><h3>资产批量生成</h3><span role="status">共 {{batchSummary.counts.total}} 项 · 候选 {{batchSummary.counts.succeeded}} · 失败 {{batchSummary.counts.failed}} · 待确认 {{batchSummary.counts.unknown}} · 未提交 {{batchSummary.counts.skipped}}</span></div>
      <p class="story-help">{{batchSummary.uncertain?'存在结果待确认的原任务，后续项目不再提交，请进入任务中心查询。':recentBatch.status==='cancelled'?'已停止后续提交；成功候选保留，尚未提交的项目不会自动重跑。':batchStopRunId===recentBatch.id?'已请求停止，等待服务返回真实状态；正在执行项可能仍需查询确认。':'各项串行生成，普通失败后继续；已有选用图片保持不变，生成成功仍需人工确认。'}}</p>
      <div class="story-action-row"><button v-if="batchSummary.active" class="story-stop-batch" :disabled="batchStopping||batchStopRunId===recentBatch.id" @click="stopBatch">{{batchStopping||batchStopRunId===recentBatch.id?'正在停止批量生成…':'停止批量生成'}}</button><button v-if="canConfirmBatchLost" :disabled="batchRecovering||!!busy||pending||saving||workflowLocked" @click="confirmBatchLost">{{batchRecovering?'正在核查原任务…':'核查原任务丢失并解除阻塞'}}</button><button @click="navigate('tasks')">查看原批量任务</button></div>
      <p v-if="canConfirmBatchLost" class="story-help">核查仅查询当前本地队列和历史；原任务仍存在时会保留锁定。确认丢失后请勾选待生成项，再批量生成，不会自动重交。</p>
      <ol class="story-batch-item-list"><li v-for="(item,index) in batchSummary.items" :key="item.assetId||index"><strong>{{item.name||story.assets.find(asset=>asset.id===item.assetId)?.name||item.assetId}}</strong><span :class="'status-'+item.status">{{storyBatchStatusLabel(item.status)}}</span><small v-if="item.error">{{item.error}}</small></li></ol>
    </section>

    <template v-if="tab==='episodes'">
      <article class="card story-source" data-story-section="source" tabindex="-1"><div class="card-heading"><h3>创作来源</h3><span>先保存要求，再按指定数量拆集</span></div><div class="story-fields story-source-options"><label>剧本来源<select v-model="story.sourceMode" :disabled="locked"><option value="upstream">使用前面步骤的最终文案</option><option value="custom">填写独立剧本</option></select></label><label>旁白方式<select v-model="story.narrationMode" :disabled="locked"><option value="none">无旁白，仅使用镜头声音设计</option><option value="upstream">使用第三步配音 / 每集指定旁白</option></select></label></div><p class="story-help">{{story.sourceMode==='custom'?'独立剧本单独保存，不改写前面步骤的最终文案。':sourceConfirmed?'已关联第二步确认文案；前文变化时会要求重新拆集。':'当前文案尚未确认，请先在第二步确认后拆集。'}}</p><label class="story-script-label">{{story.sourceMode==='custom'?'非口播剧本':'已关联文案'}}<textarea :value="story.sourceMode==='custom'?story.sourceText:upstream" :readonly="story.sourceMode!=='custom'" :disabled="locked" aria-label="非口播剧本" placeholder="填写需要拆分的故事、科普或产品短片文案" @input="story.sourceText=$event.target.value"/></label><p class="story-help">拆集保留全部原文，参考秒数不会删减正文。完成拆集后，先拆分当前集镜头，再点“提取本集资产”，由 AI 识别人物、场景和道具并绑定镜头；确认设定后另行生成图片。</p><div class="story-fields story-generation-options"><label>指定集数<input v-model.number="story.episodeCount" type="number" min="1" step="1" :disabled="locked" aria-label="指定集数"/></label><label>每集参考秒数<input v-model.number="story.episodeDuration" type="number" min="1" max="600" step="0.01" :disabled="locked" aria-label="每集参考秒数"/></label><label>画幅<select v-model="story.aspect" :disabled="locked"><option value="9:16">9:16 竖屏</option><option value="16:9">16:9 横屏</option><option value="1:1">1:1 方形</option></select></label><label>视觉风格<input v-model="story.style" :disabled="locked" placeholder="例如：自然写实、电影质感"/></label></div><div v-if="upstreamTimingVisible" class="story-notice" :class="{warning:!!upstreamTimingProblem}" aria-label="配音与计划时长"><div class="story-action-row"><div><strong>第三步配音与单集时长</strong><p>第三步配音：{{upstreamNarrationDuration===null?'时长未识别':upstreamNarrationDuration.toFixed(2)+' 秒'}} · 每集计划：{{plannedDurationLabel}}</p></div><button :disabled="!canUseUpstreamDuration" @click="useUpstreamDuration">按第三步配音设置时长</button></div><p v-if="upstreamTimingProblem">{{upstreamTimingProblem}}</p><template v-else><p>单集镜头总时长需与实际旁白接近，合成时允许的误差为0.15秒。此操作只设置计划时长，不改写音频或替换素材。</p><p v-if="story.episodes.length">已有拆集或分镜：更改时长后，请按当前要求重新拆集，再重新拆分镜头；保存后旧镜头的选用会按版本规则失效，历史候选保留，需按新计划重新生成和确认。</p><p v-else>设置后按计划拆集，再拆分镜头。</p><p v-if="hasIndependentNarration">当前集另选了旁白；本按钮不会更换它。若使用第三步配音，请到“动态视频 → 合成当前集”明确点击“使用第三步配音”。</p></template></div><label>补充要求<textarea v-model="story.instructions" class="story-brief" :disabled="locked" placeholder="主体、时代、节奏和需要避免的内容；事实类请提供可靠依据"/></label><div class="story-action-row"><p class="story-help">拆分后可逐集编辑；重新拆分会更新分集，请先保存需要保留的修改。</p><button class="primary" :disabled="locked||!sourceConfirmed" @click="splitEpisodes"><I name="Layers" :size="17"/>{{story.episodes.length?'按当前要求重新拆集':'按指定集数拆集'}}</button></div></article>
      <div v-if="story.episodes.length" class="story-workspace"><aside class="card story-episode-nav"><h3>分集列表</h3><button v-for="(item,index) in story.episodes" :key="item.id" :class="{active:episode?.id===item.id}" @click="episodeId=item.id"><strong>{{episodeName(item,index)}}</strong><small>{{item.shots.length}} 个镜头{{item.resultId?' · 已有成片':''}}</small></button></aside><article v-if="episode" class="card story-episode-editor" data-story-section="episode" tabindex="-1"><div class="card-heading"><h3>当前集剧本与分镜</h3><span>{{episode.shots.length}} 镜头 · {{episodeSeconds.toFixed(1)}} 秒</span></div><label>本集标题<input v-model="episode.title" :disabled="locked" aria-label="本集标题"/></label><label>本集正文<textarea v-model="episode.text" :disabled="locked" aria-label="本集正文"/></label><div class="story-action-row"><button class="secondary" :disabled="locked||sourceChanged" @click="run('splitStoryShots',{episodeId:episode.id},'拆分当前集镜头')"><I name="Scissors" :size="16"/>{{episode.shots.length?'重新拆分镜头':'拆分当前集镜头'}}</button><button :disabled="locked" @click="addShot"><I name="Plus" :size="16"/>新增镜头</button><button :disabled="locked||!episode.shots.length||sourceChanged" @click="extractAssets()"><I name="Database" :size="16"/>提取本集资产</button></div><div v-if="episode.shots.length" class="story-batch-toolbar" aria-label="镜头提取范围"><span>已勾选 {{selectedShotIds.length}} / {{episode.shots.length}} 个镜头</span><button :disabled="locked" @click="selectShots(true)">全选本集镜头</button><button :disabled="locked||!selectedShotIds.length" @click="selectShots(false)">取消勾选</button><button :disabled="locked||!planningReady||!shot" @click="extractAssets('current')">提取当前镜头资产</button><button :disabled="locked||!planningReady||!selectedShotIds.length" @click="extractAssets('selected')">提取勾选镜头资产（{{selectedShotIds.length}}）</button></div><div v-if="episode.shots.length" class="story-shot-list" aria-label="本集镜头"><div v-for="(item,index) in episode.shots" :key="item.id" class="story-shot-choice" :class="{checked:selectedShotIds.includes(item.id)}"><label class="story-batch-check"><input type="checkbox" :checked="selectedShotIds.includes(item.id)" :disabled="locked" :aria-label="'勾选镜头 '+(index+1)+' 提取资产'" @change="checkShot(item.id,$event.target.checked)"/></label><button :class="{active:shot?.id===item.id}" @click="shotId=item.id"><strong>镜头 {{index+1}}</strong><span>{{viewShot(item).visual||item.text||'待填写镜头'}}</span><small>{{Number(item.duration).toFixed(2)}} 秒 · 查看详情</small></button></div></div><section v-if="shot" class="story-shot-editor"><div class="card-heading"><h4>镜头详情</h4><div class="story-icon-actions"><button :disabled="locked||episode.shots[0].id===shot.id" aria-label="上移镜头" @click="moveShot(-1)"><I name="ChevronUp" :size="16"/></button><button :disabled="locked||episode.shots.at(-1).id===shot.id" aria-label="下移镜头" @click="moveShot(1)"><I name="ChevronDown" :size="16"/></button><button :disabled="locked" aria-label="删除当前镜头" @click="deleteShot"><I name="Trash2" :size="16"/></button></div></div><label>对应原文<textarea v-model="shot.text" :disabled="locked"/></label><div class="story-fields"><label>画面描述<textarea :value="shotDisplay.visual" :readonly="shotDisplay.translated" @input="setDesignField('visual',$event.target.value)" :disabled="locked"/></label><label>人物 / 主体动作<textarea :value="shotDisplay.action" :readonly="shotDisplay.translated" @input="setDesignField('action',$event.target.value)" :disabled="locked"/></label><label>景别与运镜<input :value="shotDisplay.camera" :readonly="shotDisplay.translated" @input="setDesignField('camera',$event.target.value)" :disabled="locked" placeholder="例如：中景，缓慢推近"/></label><label>镜头时长（秒）<input v-model.number="shot.duration" type="number" min="0.1" step="0.1" :disabled="locked"/></label></div><label>镜头声音<textarea :value="shotDisplay.sound" :readonly="shotDisplay.translated" @input="setDesignField('sound',$event.target.value)" class="story-brief" :disabled="locked" placeholder="环境音、音效或对白要求"/></label><fieldset class="story-bindings"><legend>绑定本镜头资产</legend><label v-for="item in story.assets" :key="item.id" class="story-checkbox"><input type="checkbox" :checked="shot.assetIds.includes(item.id)" :disabled="locked" @change="setBinding(item.id,$event.target.checked)"/><span>{{storyKindLabel[item.kind]}} · {{item.name}}</span><small>{{item.selectedImageId?'图片已确认':'图片待确认'}}</small></label><p v-if="!story.assets.length" class="story-help">先提取本集资产，或前往“资产图片”添加人物、场景、道具。</p><template v-if="localImage&&!textOnlyImage&&boundAssets.length"><label>本地构图主参考<select v-model="primaryReference" :disabled="locked" aria-label="本地构图主参考"><option value="">请选择主参考资产</option><option v-for="item in boundAssets" :key="item.id" :value="item.id">{{storyKindLabel[item.kind]}} · {{item.name}}</option></select></label><p class="story-help">本地仅主参考图片参与图生图，其余绑定只传文字描述，不能保证多主体外观一致。</p></template><p v-if="textOnlyImage&&boundAssets.length" class="story-help">当前 Z-Image 不支持绑定参考图，请选用已有首帧或切换支持参考的模型。</p><p v-else-if="!localImage&&boundAssets.length" class="story-help">云端兼容图片接口会提交全部已绑定资产的确认图片。</p></fieldset><details v-if="!props.productMode" class="story-prompt-details"><summary>查看和编辑镜头提示词</summary><label>构图图提示词<textarea v-model="shot.imagePrompt" :disabled="locked"/></label><label>视频提示词<textarea v-model="shot.videoPrompt" :disabled="locked"/></label></details><p v-if="props.productMode" class="story-help">本次视频依据上面的中文画面、主体动作、景别与运镜、镜头声音生成；修改后请先保存镜头要求。</p><div class="story-action-row"><p class="story-help">修改描述、动作或绑定后，保存会使受影响的选用结果失效，候选历史继续保留。</p><button :disabled="locked||!dirty" @click="run('saveStory')">保存镜头修改</button></div></section></article></div>
      <div v-else class="story-empty card"><I name="Layers" :size="34"/><h3>从当前文案开始拆集</h3><p>指定集数后生成分集，再逐集拆分镜头和提取共享资产。</p></div>
    </template>

    <template v-else-if="tab==='assets'">
      <p v-if="!story.episodes.length" class="story-notice warning">请先在“分集分镜”完成拆集，再生成或确认资产图片。资产设定可以提前填写并保存。</p>
      <div class="story-action-row story-section-actions"><div class="story-fields"><label>显示范围<select v-model="assetScope"><option value="episode">本集引用资产</option><option value="all">全部共享资产</option></select></label><label>资产类型<select v-model="kind"><option value="all">全部资产</option><option value="character">人物</option><option value="scene">场景</option><option value="prop">道具</option></select></label><label>当前分集<select :value="episode?.id||''" @change="episodeId=$event.target.value"><option v-if="!story.episodes.length" value="">尚未拆集</option><option v-for="(item,index) in story.episodes" :key="item.id" :value="item.id">{{episodeName(item,index)}}</option></select></label></div><button :disabled="locked" @click="addAsset"><I name="Plus" :size="16"/>添加资产</button><button :disabled="locked||!episode?.shots.length||sourceChanged" @click="extractAssets()">提取本集资产</button></div>
      <div class="story-batch-toolbar" aria-label="资产批量生成范围"><span>已勾选 {{selectedAssetIds.length}} / {{visibleAssets.length}} 项（当前筛选）</span><button :disabled="locked||!visibleAssets.length" @click="selectAssets('all')">全选当前筛选</button><button :disabled="locked||!visibleAssets.length" @click="selectAssets('missing')">勾选待生成项</button><button :disabled="locked||!selectedAssetIds.length" @click="selectAssets('none')">取消勾选</button><button class="primary" :disabled="locked||!planningReady||!selectedAssetIds.length" @click="generateCheckedAssets">批量生成勾选资产（{{selectedAssetIds.length}}）</button><p>待生成项不包含已有可用候选或已明确选用图片的资产。批量生成只新增候选，保留已有选用；每项沿用其详情中的修改要求，完成后仍需逐项预览确认。</p></div><div v-if="asset" class="story-workspace story-assets-workspace"><aside class="card story-asset-nav"><h3>{{assetScope==='episode'?'本集引用资产':'全部共享资产'}} · {{visibleAssets.length}}</h3><div v-for="item in visibleAssets" :key="item.id" class="story-asset-choice" :class="{checked:selectedAssetIds.includes(item.id)}"><label class="story-batch-check"><input type="checkbox" :checked="selectedAssetIds.includes(item.id)" :disabled="locked" :aria-label="'勾选资产 '+item.name+' 批量生成'" @change="checkAsset(item.id,$event.target.checked)"/></label><button :class="{active:asset.id===item.id}" :aria-label="'查看资产 '+item.name" @click="viewAsset(item.id)"><img v-if="item.selectedImageId" :src="mediaUrl(item.selectedImageId)" alt="已确认资产图"/><I v-else :name="item.kind==='character'?'User':item.kind==='scene'?'House':'Layers'" :size="26"/><span><strong>{{item.name}}</strong><small>{{storyKindLabel[item.kind]}} · {{item.selectedImageId?'已确认图片':'待确认图片'}}</small><small>查看详情</small></span></button></div></aside><article class="card story-asset-editor" data-story-section="asset" tabindex="-1"><div class="card-heading"><h3>资产设定</h3><button :disabled="locked" class="text-button danger" @click="removeAsset">删除资产</button></div><div class="story-fields"><label>名称<input v-model="asset.name" :disabled="locked" aria-label="资产名称"/></label><label>类型<select v-model="asset.kind" :disabled="locked"><option value="character">人物</option><option value="scene">场景</option><option value="prop">道具</option></select></label></div><section class="shot-translation-panel" aria-label="资产中文阅读"><div class="card-heading"><h4>资产中文阅读</h4><span>{{assetDisplay.translated?'当前显示中文译稿 · 只读':'原资产设定'}}</span></div><p class="story-help">旧英文设定可转换为中文阅读译稿。转换只保存阅读附件，生成继续沿用原提示词，已选图片保持不变。</p><div class="story-action-row"><button :disabled="locked||dirty||!assetNeedsTranslation||assetDisplay.translated" @click="translateAssetDesign">转换当前资产为中文</button><button v-if="assetDisplay.translated" :disabled="locked" @click="editAssetChineseTranslation">用中文译稿编辑设定</button></div><p v-if="dirty" class="story-help">请先保存当前修改，再转换中文阅读译稿。</p><p v-if="assetTranslationStatus" class="story-help" role="status">{{assetTranslationStatus}}</p><p v-if="assetDisplay.translated" class="story-help">译稿当前只读。点击“用中文译稿编辑设定”才会写入资产；保存后旧资产图与引用镜头的选用会按版本规则失效，历史候选保留。</p><details v-if="assetDisplay.translated"><summary>核对原始资产内容</summary><dl><dt>外观与识别特征</dt><dd>{{asset.description||'未填写'}}</dd><dt>资产图片提示词</dt><dd>{{asset.prompt||'未填写'}}</dd></dl></details></section><label>外观与识别特征<textarea :value="assetDisplay.description" :readonly="assetDisplay.translated" @input="setAssetDesignField('description',$event.target.value)" :disabled="locked" placeholder="用于跨镜头复用的外观、服装、环境或材质特征"/></label><label>资产图片提示词<textarea :value="assetDisplay.prompt" :readonly="assetDisplay.translated" @input="setAssetDesignField('prompt',$event.target.value)" :disabled="locked" placeholder="用中文描述主体外观、构图、光线和需要保留的细节"/></label><p class="story-help">共享资产通过稳定 ID 绑定镜头；生成图片只新增候选，需要手动确认。改设定或改选图片会影响引用该资产的镜头。</p><label>本次修改要求<textarea v-model="correction" class="story-brief" :disabled="locked" placeholder="例如：保留服装，将表情调整得更自然"/></label><div class="story-action-row"><button class="primary" :disabled="locked||!planningReady" @click="run('generateStoryImage',{...assetPayload(),instruction:correction},'生成资产图片')"><I name="ImagePlus" :size="17"/>{{asset.images.length?'按当前要求再生成':'生成资产图片'}}</button><button :disabled="locked||!planningReady" @click="chooseImage(assetPayload())"><I name="FolderOpen" :size="17"/>导入 / 选用已有图</button><button :disabled="locked||!dirty" @click="run('saveStory')">保存设定</button></div><div v-if="asset.images.length" class="story-candidates"><article v-for="(item,index) in asset.images" :key="item.id" class="story-candidate" :class="{selected:asset.selectedImageId===item.id,stale:item.status==='stale'}"><button class="story-candidate-preview" :aria-label="'预览资产候选 '+(index+1)" @click="preview={id:item.id,type:'image',title:asset.name+' · 候选 '+(index+1)}"><img :src="mediaUrl(item.id)" :alt="asset.name+' 候选 '+(index+1)" loading="lazy"/></button><div><strong>候选 {{index+1}}</strong><span class="story-status">{{describeCandidate(item)}}</span><details><summary>生成记录</summary><p>{{candidateInstruction(item)}}</p><small>{{item.createdAt}}</small></details><button :disabled="locked||item.status==='stale'||asset.selectedImageId===item.id" @click="run('selectStoryImage',{...assetPayload(),imageId:item.id},'确认资产图片')">{{asset.selectedImageId===item.id?'已选用':'确认选用此图'}}</button></div></article></div><div v-else class="story-inline-empty">尚无图片候选。可生成新图，或选择已有图片后确认。</div></article></div><div v-else class="story-empty card"><I name="Database" :size="34"/><h3>建立可复用的视觉资产</h3><p>{{assetScope==='episode'?'本集当前没有符合筛选的绑定资产；可先提取本集资产，或切换全部共享资产查看并绑定。':'从分镜提取人物、场景和道具，也可以手动添加。'}}</p><button v-if="assetScope==='episode'" @click="assetScope='all';kind='all'">查看全部共享资产</button><button :disabled="locked" @click="addAsset">添加第一个资产</button></div>
    </template>

    <template v-else>
      <div class="story-fields story-video-selection"><label>当前分集<select :value="episode?.id||''" @change="episodeId=$event.target.value"><option v-if="!story.episodes.length" value="">尚未拆集</option><option v-for="(item,index) in story.episodes" :key="item.id" :value="item.id">{{episodeName(item,index)}}</option></select></label><label>当前镜头<select :value="shot?.id||''" @change="shotId=$event.target.value"><option v-if="!episode?.shots.length" value="">尚无镜头</option><option v-for="(item,index) in episode?.shots||[]" :key="item.id" :value="item.id">镜头 {{index+1}} · {{Number(item.duration).toFixed(2)}} 秒</option></select></label></div>
      <article v-if="props.productMode&&shot" class="card product-motion-editor"><div class="card-heading"><h4>当前镜头的产品介绍设计</h4><span>对应台词与声音时间轴已关联</span></div><p class="product-help">旁白：{{shot.text}}</p><div class="product-facts"><label class="product-field">屏显卖点（最多160字）<input v-model="shot.sellingPoint" :disabled="locked" maxlength="160" aria-label="产品介绍镜头屏显卖点" placeholder="如实描述产品特点，不升级为实测功效"/></label><label class="product-field">卖点依据<textarea v-model="shot.evidence" :disabled="locked" maxlength="1000" aria-label="产品介绍镜头卖点依据" placeholder="填写商品详情明确支持的事实依据"/></label></div><p class="product-help">第二步确认的是旁白正文；屏显卖点、依据和主体动作仍须逐镜核对。无可靠依据的功效表述请删除，不会因正文已确认而自动视为事实。</p><div class="product-facts"><label class="product-field product-full">画面内容<textarea :value="shotDisplay.visual" :readonly="shotDisplay.translated" @input="setDesignField('visual',$event.target.value)" :disabled="locked" aria-label="产品介绍镜头画面内容"/></label><label class="product-field">主体动作<textarea :value="shotDisplay.action" :readonly="shotDisplay.translated" @input="setDesignField('action',$event.target.value)" :disabled="locked" aria-label="产品介绍镜头主体动作"/></label><label class="product-field">景别与运镜<textarea :value="shotDisplay.camera" :readonly="shotDisplay.translated" @input="setDesignField('camera',$event.target.value)" :disabled="locked" aria-label="产品介绍镜头景别与运镜"/></label></div><section class="story-design-optimizer" aria-label="中文产品镜头优化"><div class="card-heading"><h4>中文镜头优化</h4><span>先预览建议，再决定是否应用</span></div><label>本次优化要求（可选）<textarea v-model="shotDesignInstruction" :disabled="locked" maxlength="1500" aria-label="中文镜头优化要求" placeholder="例如：突出羽毛被轻轻带动的过程，前两秒动作清晰可见，保持商品外观与原图一致"/></label><div class="story-action-row"><button :disabled="locked||sourceChanged" @click="proposeShotDesign">优化当前镜头为中文</button><span class="story-help">界面中文编辑，系统按模型格式组装生成指令。建议参考当前旁白、卖点依据、商品图和镜头时长；不会自动覆盖。</span></div><section v-if="shotDesignCandidate" class="story-design-candidate" aria-label="中文镜头优化候选" aria-live="polite"><h4>中文优化建议 · 待确认</h4><p class="story-help">应用后会保存新设计，并让受影响的首帧与视频选用失效；历史候选保留。旁白、卖点、依据、素材绑定和时长保持当前值。</p><div class="story-design-comparison"><article v-for="[key,label] in shotDesignFields" :key="key" class="story-design-field"><h5>{{label}}</h5><div><section><strong>当前内容</strong><p>{{shotDesignCandidate.before[key]||'未填写'}}</p></section><section><strong>中文优化建议</strong><p>{{shotDesignCandidate.design[key]}}</p></section></div></article></div><div class="story-action-row"><button class="primary" :disabled="locked" @click="applyShotDesign">应用并保存中文设计</button><button :disabled="locked" @click="cancelShotDesign">取消，保留当前设计</button></div></section></section><p class="product-help">可修改屏显卖点、依据、画面、动作和运镜。修改第二步文案或第三步声音后，请回上方重新核对分镜。动作变化会使当前首帧与视频选用失效，请重新确认参考图后生成；候选记录保留。</p><div class="product-actions"><button :disabled="locked||!dirty" @click="run('saveStory')">保存镜头要求</button><span v-if="shot.iconIds?.length" class="product-help">本镜头绑定 {{shot.iconIds.length}} 个原始图标，合成时独立叠加。</span></div></article>
      <div v-if="shot" class="story-video-grid"><article class="card story-frame-panel" data-story-section="frame" tabindex="-1"><div class="card-heading"><h3>{{props.productMode?'1 · 商品镜头参考图':'1 · 镜头首帧（构图图）'}}</h3><span>{{Number(shot.duration).toFixed(2)}} 秒</span></div><p class="story-shot-description">{{shotDisplay.visual||shot.text||'请先补充镜头画面描述'}}</p><fieldset v-if="!props.productMode" class="story-bindings" data-story-section="bindings" tabindex="-1"><legend>本镜头资产绑定与主参考</legend><label v-for="item in story.assets" :key="item.id" class="story-checkbox"><input type="checkbox" :checked="shot.assetIds.includes(item.id)" :disabled="locked" @change="setBinding(item.id,$event.target.checked)"/><span>{{storyKindLabel[item.kind]}} · {{item.name}}</span><small>{{item.selectedImageId?'图片已选用':'图片待确认'}}</small></label><p v-if="!story.assets.length" class="story-help">尚无共享资产，请先从分镜提取或添加资产。</p><label v-if="localImage&&!textOnlyImage&&boundAssets.length">本地构图主参考<select v-model="primaryReference" :disabled="locked" aria-label="视频页本地构图主参考"><option value="">请选择主参考资产</option><option v-for="item in boundAssets" :key="item.id" :value="item.id">{{storyKindLabel[item.kind]}} · {{item.name}}</option></select></label><button :disabled="locked" @click="goTo({tab:'assets',episodeId:episode.id,assetId:boundAssets.find(item=>!item.selectedImageId)?.id||boundAssets[0]?.id,section:'asset'})">前往确认本集资产图片</button><p class="story-help">绑定修改会保存并使受影响的首帧和视频选用失效，历史候选保留。生成不会自动确认。</p></fieldset><div class="story-bound-summary"><span v-for="id in shot.assetIds" :key="id">{{story.assets.find(item=>item.id===id)?.name||'缺失资产'}}</span></div><p v-if="textOnlyImage&&!props.productMode" class="story-notice warning">Z-Image 仅支持纯文生图，不能使用本镜头绑定的参考图。可选用已有首帧，或在服务设置切换支持参考的模型。<button :disabled="locked" @click="openModelSettings">检查服务设置</button></p><p v-else-if="localImage&&!props.productMode" class="story-help">本地仅主参考图片参与图生图，其余绑定只传文字描述，不能保证多主体外观一致。<template v-if="primaryReference">当前主参考：{{boundAssets.find(item=>item.id===primaryReference)?.name}}</template></p><p v-for="reason in imageIssues" :key="reason" class="story-notice warning">{{reason}}</p><div class="story-frame-preview"><img v-if="shot.selectedImageId" :src="mediaUrl(shot.selectedImageId)" alt="已确认的镜头构图图"/><div v-else><I name="Image" :size="36"/><p>尚未确认构图图</p></div></div><label>本次画面 / 视频修改要求<textarea v-model="correction" class="story-brief" :disabled="locked" placeholder="不改变已绑定资产的前提下，调整构图、动作或运镜"/></label><div class="story-action-row"><button v-if="!props.productMode" class="primary" :disabled="locked||!!imageIssues.length||sourceChanged" :title="imageIssues.join('；')" @click="run('generateStoryImage',{...shotPayload(),instruction:correction},'生成镜头构图图')">{{shot.images.length?'重新生成构图图':'生成构图图'}}</button><button :disabled="locked||!!issues.length" @click="chooseImage(shotPayload())">{{props.productMode?'更换镜头参考图':'选用已有构图图'}}</button></div><div class="story-filmstrip"><article v-for="(item,index) in shot.images" :key="item.id" :class="{selected:shot.selectedImageId===item.id,stale:item.status==='stale'}"><button :aria-label="'预览镜头构图候选 '+(index+1)" @click="preview={id:item.id,type:'image',title:'镜头构图候选 '+(index+1)}"><img :src="mediaUrl(item.id)" :alt="'镜头构图候选 '+(index+1)" loading="lazy"/></button><span>{{describeCandidate(item)}}</span><button :disabled="locked||item.status==='stale'||shot.selectedImageId===item.id" @click="run('selectStoryImage',{...shotPayload(),imageId:item.id},'确认镜头构图图')">{{shot.selectedImageId===item.id?'已选用':'确认此图'}}</button></article></div></article><article class="card story-motion-panel" data-story-section="motion" tabindex="-1"><div class="card-heading"><h3>2 · 镜头动态视频</h3><span>逐镜头生成并确认</span></div><p v-for="reason in videoIssues" :key="reason" class="story-notice warning">{{reason}}</p><div class="story-frame-preview"><video v-if="shot.selectedVideoId" :key="shot.selectedVideoId" :src="mediaUrl(shot.selectedVideoId)" controls preload="metadata"/><div v-else><I name="Video" :size="36"/><p>尚未选用动态视频</p></div></div><p class="story-help">动作：{{shotDisplay.action||'未填写'}}<br/>景别与运镜：{{shotDisplay.camera||'未填写'}}<br/>声音：{{shotDisplay.sound||'未填写'}}</p><button class="primary full" :disabled="locked||!!videoIssues.length||sourceChanged" :title="videoIssues.join('；')" @click="run('generateStoryVideo',{...shotPayload(),instruction:correction},props.productMode?'生成产品介绍动态镜头':'生成非口播镜头视频')">{{shot.videos.length?'按当前要求再生成视频':'生成镜头视频'}}</button><div v-if="shot.videos.length" class="story-video-candidates"><article v-for="(item,index) in shot.videos" :key="item.id" :class="{selected:shot.selectedVideoId===item.id,stale:item.status==='stale'}"><video :src="mediaUrl(item.id)" controls preload="metadata"/><div><strong>视频候选 {{index+1}}</strong><span>{{describeCandidate(item)}}</span><button :disabled="locked||item.status==='stale'||shot.selectedVideoId===item.id" @click="run('selectStoryVideo',{...shotPayload(),videoId:item.id},'确认镜头视频')">{{shot.selectedVideoId===item.id?'已选用':'选用此视频'}}</button></div></article></div><p v-else class="story-inline-empty">生成成功后在这里试听、预览并选择版本。</p></article></div><div v-else class="story-empty card"><I name="Video" :size="34"/><h3>先完成分镜与资产图片</h3><p>选定一个镜头后，依次确认构图图并生成动态视频。</p><button @click="tab='episodes'">返回分集分镜</button></div>
      <article v-if="episode" class="card story-composition" data-story-section="composition" tabindex="-1"><div class="card-heading"><h3>3 · 合成当前集</h3><span>{{episode.shots.filter(item=>item.selectedVideoId).length}} / {{episode.shots.length}} 镜头已选用</span></div><p>{{props.productMode?'合成已确认的产品动态镜头、第三步旁白及原图标。镜头顺序与确认稿一致。':'仅合成当前集，顺序与“分集分镜”中的镜头一致。多集分别制作和导出。'}}</p><div v-if="story.narrationMode==='upstream'&&!props.productMode" class="story-narration"><span>本集旁白：{{selectedNarration?.name||(effectiveNarrationId?'所选音频不可用':'未指定')}}<small v-if="selectedNarrationSource"> · {{selectedNarrationSource}}</small></span><button :disabled="locked" @click="picker={kind:'audio',title:'选择当前集旁白',episodeId:episode.id}">选择本集音频</button><button v-if="draft.voice.audioId&&story.episodes.length===1" :disabled="locked" @click="episode.narrationAssetId=draft.voice.audioId">使用第三步配音</button><button v-if="episode.narrationAssetId" :disabled="locked" @click="episode.narrationAssetId=''">{{story.episodes.length===1&&draft.voice.audioId?'恢复单集默认配音':'清除本集旁白'}}</button><p class="story-help">单集未另选音频时默认使用第三步配音；多集需要逐集指定音频，不会把整条配音随意切分给不同集。需要无旁白时，请在创作来源选择“无旁白”。</p></div><p v-if="composeReason" class="story-notice warning">{{composeReason}}</p><div v-if="episode.resultId" class="story-result"><video :key="episode.resultId" :src="mediaUrl(episode.resultId)" controls preload="metadata"/><span>当前集成片 · 请检查完整播放、声音与镜头连续性</span></div><div class="story-action-row"><button class="primary" :disabled="locked||!!composeReason||sourceChanged" :title="composeReason" @click="run('composeStoryEpisode',{episodeId:episode.id},'按镜头顺序合成当前集')">{{episode.resultId?'重新合成当前集':'合成当前集'}}</button><button :disabled="locked||!episode.resultId||sourceChanged" @click="run('useStoryEpisode',{episodeId:episode.id},'将当前集交接后续剪辑')"><I name="Scissors" :size="17"/>使用当前集，进入网感剪辑</button></div></article>
    </template>
    <AssetPicker v-if="picker" :kind="picker.kind" :title="picker.title" @close="picker=null" @select="picked"/>
    <Modal v-if="preview" :title="preview.title" wide variant="story-image-preview" @close="preview=null"><img class="story-large-image" :src="mediaUrl(preview.id)" :alt="preview.title"/></Modal>
  </section>
</template>
