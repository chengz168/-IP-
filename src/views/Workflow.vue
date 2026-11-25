<script setup>
import {inject,ref,computed,nextTick,watch} from 'vue';
import I from '../components/Icon.vue';
import WordLimit from '../components/WordLimit.vue';
import DropdownSelect from '../components/DropdownSelect.vue';
import Modal from '../components/Modal.vue';
import AssetPicker from '../components/AssetPicker.vue';
import PipEditor from '../components/PipEditor.vue';
import PipPanel from '../components/PipPanel.vue';
import CaptionEditor from '../components/CaptionEditor.vue';
import SubtitlePanel from '../components/SubtitlePanel.vue';
import TitlePanel from '../components/TitlePanel.vue';
import {titleDesign,titleTemplates} from '../../server/title-model.mjs';
import BrainStudio from '../components/BrainStudio.vue';
import CopyStudio from '../components/CopyStudio.vue';
import EditPreview from '../components/EditPreview.vue';
import EditModuleNav from '../components/EditModuleNav.vue';
import NamecardPanel from '../components/NamecardPanel.vue';
import BgmPanel from '../components/BgmPanel.vue';
import PublishPanel from '../components/PublishPanel.vue';
import ProductionReview from '../components/ProductionReview.vue';
import VideoPanel from '../components/VideoPanel.vue';
import VoicePanel from '../components/VoicePanel.vue';
import MediaPreview from '../components/MediaPreview.vue';
import CoverEditor from '../components/CoverEditor.vue';
import {promptsFor,resolvePrompt} from '../../server/prompt-catalog.mjs';
import {runTextAction} from '../text-action.mjs';
import {confirmCopyAction} from '../copy-confirmation-action.mjs';
import {runSpeechAction} from '../speech-action.mjs';
import {runAvatarAction} from '../avatar-action.mjs';
import ExtractionPanel from '../components/ExtractionPanel.vue';
import {batchOwnsOperationStatus} from '../extract-batch-ui.mjs';
import WorkflowStatus from '../components/WorkflowStatus.vue';
import OperationStatus from '../components/OperationStatus.vue';
import {call} from '../api';
import {recognitionSnapshot,canApplyRecognition} from '../recognition-state';
import {recognitionRows,recognitionOptions} from '../caption-recognition.mjs';
import {alignRowsToReference} from '../caption-script.mjs';
import {changeCaptionSource} from '../caption-source.mjs';
import {openCaptionSession} from '../caption-edit-session.mjs';
import {getSubtitleTemplate} from '../../server/subtitle-templates.mjs';
import {workflowOutputStatus} from '../workflow-output-status.mjs';
import {moveWorkflowStep} from '../workflow-navigation.mjs';
import ReferenceAnalysis from '../components/ReferenceAnalysis.vue';
import ProductStudio from '../components/ProductStudio.vue';
import CreativePresets from '../components/CreativePresets.vue';
import '../reference-analysis.css';
const props=defineProps({view:String});
const {state,draft:d,busy,activeRecognition,notify,act,refresh,save,importAssets,showDialog,newTask,navigate,stepNames,startWorkflow,workflowLocked}=inject('studio');
const icons=['BulbOutlined','EditOutlined','SoundOutlined','VideoCameraOutlined','ScissorOutlined','PictureOutlined','RocketOutlined'];
const pipModal=ref(false),pipSaving=ref(false);
const coverEditor=ref();
const picker=ref(null),subtitleModal=ref(false),legal=ref(''),editTab=ref('params'),advanced=ref(false),silenceReport=ref(null);
const captionSession=ref(null);
function showCaptionEditor(){captionSession.value=openCaptionSession(captionSession.value,d.value);subtitleModal.value=true;}
const tabs=[['extract','提取文案'],['ref-analysis','视频拆解'],['product','商品宣传'],['brain','IP大脑'],['topic','爆款选题'],['marketing','营销文案']];
const activeStep=computed(()=>d.value.step||0);
const stepNavigating=ref(false);
function goStep(target){return moveWorkflowStep({target,draft:d,save,navigating:stepNavigating,notify});}
const visibleExtractionBatch=ref('');
const extractionOwnsStatus=computed(()=>batchOwnsOperationStatus({step:activeStep.value,tab:d.value.tab,draftId:d.value.id,batchId:visibleExtractionBatch.value,run:activeRecognition.value,busy:busy.value}));
const rewritePrompt=computed(()=>resolvePrompt('rewrite',state.value,d.value.template));
const rewriteTemplate=computed({get:()=>rewritePrompt.value.id,set:id=>d.value.template=id});
const rewriteOptions=computed(()=>promptsFor('rewrite',state.value).map(p=>({value:p.id,label:p.name})));
const sourceVideo=computed(()=>d.value.edit.sourceId||d.value.video.assetId);
// 按原版区分字幕识别和剪辑的加载状态，共用已有操作锁阻止重复提交。
const subtitleGenerating=computed(()=>busy.value==='生成字幕'),videoEditing=computed(()=>busy.value==='剪辑视频');
watch([()=>d.value.id,sourceVideo],()=>{subtitleModal.value=false;captionSession.value=null;});
const currentAsset=computed(()=>state.value.assets.find(a=>a.id===sourceVideo.value));
const subtitleSummary=computed(()=>{const edit=d.value.edit;if(!edit.subtitlesEnabled)return '已关闭';if(edit.subtitleMode==='template'){const template=getSubtitleTemplate(edit.subtitleTemplate);return (template?.name||'请选择模板')+(template?.keywordSupported&&edit.subtitleKeywords?' · 关键词高亮':'');}return edit.subtitleCustom?'自定义样式':'已开启';});
const titleSummary=computed(()=>{const edit=d.value.edit,design=titleDesign(edit);return !edit.titleEnabled?'已关闭':design.mode==='template'?titleTemplates.find(t=>t.id===design.templateId)?.name||'选择模板':'自定义样式';});
// 平台结果沿用任务中心的有效凭据判断，不能把任意发布记录当成导出。
const publishStatus=computed(()=>{const v=d.value,stage=state.value.taskSummaries?.find(task=>task.id===v.id)?.stages[6];if(stage?.available)return '平台 '+stage.label;const latest=state.value.runs.find(run=>run.type==='publish'&&run.draftId===v.id);if(['running','queued'].includes(latest?.status))return '平台 正在处理';if(latest?.status==='unknown')return '平台 结果待确认';const record=state.value.publishRecords.find(record=>record.id===v.publish.recordId&&record.draftId===v.id);return record?.status==='exported'?'发布包 已导出':'发布信息 待发布';});
const status=computed(()=>{const v=d.value;return [v.sourceText?'原文案 已填写':'原文案 未填写',v.confirmed?'最终文案 已确认':v.rewrite?'改写文案 已填写':'改写文案 未填写',...([2,3,4,5].map(step=>workflowOutputStatus(state.value,v,step))),publishStatus.value][activeStep.value];});
function choose(kind,assign,title){picker.value={kind,assign,title};}
function selectVideoSource(asset){return changeCaptionSource({draft:d,save},asset.id);}
async function selected(asset){const assign=picker.value.assign;picker.value=null;try{await assign(asset);await save();await refresh();}catch(error){notify(error.message,'error');}}
function openPip(){if(!sourceVideo.value){notify('请先选择视频文件');return;}if(!d.value.edit.captions.length){notify('请先生成或导入字幕');return;}pipModal.value=true;}
async function confirmPip(rows){const previous=JSON.parse(JSON.stringify(d.value.edit));pipSaving.value=true;try{d.value.edit.captions=rows;d.value.edit.pipMode='captions';d.value.edit.pipEnabled=rows.some(r=>r.pipId)||!!d.value.edit.pipCategory;await save();pipModal.value=false;notify('逐句画中画已保存','success');}catch(error){d.value.edit=previous;notify('画中画保存失败：'+error.message,'error');}finally{pipSaving.value=false;}}
function textAction(kind){return runTextAction({draft:d,state,save,act,call,notify,showDialog,showLegal:text=>legal.value=text},kind);}
function confirmCopy(){return confirmCopyAction({draft:d,save,act,call,notify,startWorkflow});}
async function generate(action,field){if(action==='speech')return runSpeechAction({draft:d,state,save,act,call,notify});if(action==='avatar')return runAvatarAction({draft:d,state,save,act,call,notify});const taskId=d.value.id;const r=await act({render:'剪辑视频'}[action],()=>call(action,{id:taskId}));if(r){if(r.stale||d.value.id!==taskId){notify('输入已变化，新产物已保存到素材库，请重新选择');return;}const [group,key]=field.split('.');d.value[group][key]=r.id;notify('产物已生成并通过媒体格式校验','success');}}
async function importCaption(asset){const r=await act('导入字幕',async()=>call('importCaptions',{text:await call('assetText',{id:asset.id})}));if(r){d.value.edit.captions=r;d.value.edit.subtitlesEnabled=true;showCaptionEditor();}}
async function analyzeSilence(){const r=await act('检测视频静音',()=>call('analyzeSilence',{id:d.value.id}));if(r)silenceReport.value=r;}
async function transcribe(){
 if(!sourceVideo.value||busy.value)return;
 const snapshot=recognitionSnapshot(d.value,'transcribe',state.value),assetId=sourceVideo.value,duration=Number(currentAsset.value?.duration);
 const r=await act('生成字幕',()=>call('transcribe',{id:snapshot.id,assetId}));
 if(!r)return;
 if(r.stale||!canApplyRecognition(snapshot,d.value,state.value)||JSON.stringify(r.referenceInput)!==JSON.stringify(snapshot.referenceInput)){notify('视频源、字幕、识别配置、讲稿或任务已变化，本次识别结果保留在执行记录中，未覆盖当前字幕');return;}
  try{const rows=alignRowsToReference(recognitionRows(r,Number.isFinite(duration)&&duration>0?duration:Number(r.duration),recognitionOptions(d.value.edit)),r.reference?.text||'');if(r.sourceAssetId&&r.sourceAssetId!==assetId)throw Error('识别结果的视频源不符，当前字幕已保留');d.value.edit.captions=rows;d.value.edit.subtitlesEnabled=true;await save();if(d.value.id===snapshot.id&&sourceVideo.value===assetId&&activeStep.value===4)showCaptionEditor();}
 catch(error){notify(error.message,'error');}
}
async function openSubtitleEditor(){if(busy.value||workflowLocked.value)return;try{await save();}catch(error){notify(error.message,'error');return;}if(!sourceVideo.value){notify('请先选择视频');return;}showCaptionEditor();}
async function exportPack(){const r=await act('导出发布包',()=>call('exportPackage',{id:d.value.id}));if(r){d.value.publish.recordId=r.id;showDialog('发布包已导出',r.directory+'\n已包含真实视频和发布信息，尚未上传到平台。');}}
async function next(){if(busy.value||workflowLocked.value||stepNavigating.value)return;if(activeStep.value===1){if(!await confirmCopy())return;if(['auto','background'].includes(d.value.mode))return;}if(activeStep.value===5&&!d.value.cover.assetId){const generated=await coverEditor.value?.generate();if(!generated)return;}const generateCoverTitle=activeStep.value===4;if(activeStep.value<6&&!await goStep(activeStep.value+1))return;if(generateCoverTitle){await nextTick();await coverEditor.value?.generateTitle();}}
function formatTime(n){return Number(n||0).toFixed(2);}
</script>
<template>
<div class="workflow" :class="{'old-workflow':view==='old'}">
  <aside class="step-sidebar"><div class="sidebar-heading"><h1>{{view==='old'?'旧工作流':'新工作流'}}</h1><button class="pill" @click="newTask">开始新任务</button></div><p class="sidebar-description">按步骤完成从对标学习到一键发布<br/>的完整创作流程</p><div class="steps"><button v-for="(name,i) in stepNames" :key="i" :class="{active:activeStep===i,done:activeStep>i}" :disabled="stepNavigating" @click="goStep(i)"><em>{{i+1}}</em><span class="step-icon"><I :name="icons[i]" :size="22"/></span><strong>{{name}}</strong></button></div><div v-if="view==='old'" class="sidebar-task"><span>当前任务</span><input v-model="d.title" aria-label="任务名称"/><button @click="navigate('tasks')">查看全部任务 <I name="ArrowRight" :size="13"/></button></div></aside>
  <section class="workflow-main"><h2 class="page-title">{{stepNames[activeStep]}}<span v-if="view==='old'" class="subtle">同一任务 · 紧凑视图</span></h2>
    <div v-if="view==='old'" class="legacy-strip"><button v-for="(name,i) in stepNames" :key="i" :class="{active:activeStep===i}" :disabled="stepNavigating" @click="goStep(i)">{{i+1}} {{name}}<small>{{i<2?'文案':i<4?'生成':'制作'}}</small></button></div>
    <section class="stage-body" :class="['stage-'+activeStep,{'stage-story':activeStep===3&&['story','product'].includes(d.video.mode)}]" :inert="workflowLocked">
      <template v-if="activeStep===0"><div class="segmented main-tabs"><button v-for="[id,label] in tabs" :key="id" :class="{active:d.tab===id}" @click="d.tab=id">{{label}}</button></div>
        <ExtractionPanel v-if="d.tab==='extract'" @batch-visible="visibleExtractionBatch=$event"/>

        <template v-else-if="d.tab==='ref-analysis'"><CreativePresets stage="analysis" :context="{kind:'reference'}"/><ReferenceAnalysis/></template>
        <ProductStudio v-else-if="d.tab==='product'"/>
        <template v-else-if="d.tab==='brain'"><CreativePresets stage="script"/><BrainStudio/></template>
        <template v-else><CreativePresets :stage="d.tab==='topic'?'topic':'script'" :context="{kind:d.tab==='topic'?'topic':'marketing'}"/><CopyStudio :kind="d.tab==='topic'?'topic':'marketing'"/></template>
      </template>
      <template v-else-if="activeStep===1"><CreativePresets stage="rewrite"/><article class="card rewrite-config"><h3>改写配置</h3><div class="rewrite-controls"><label>写作提示词<DropdownSelect v-model="rewriteTemplate" aria-label="写作提示词" variant="rewrite" :options="rewriteOptions"/></label><WordLimit v-model="d.wordLimit" label="字数" variant="rewrite"/><button class="primary" :disabled="!!busy" @click="textAction('rewrite')"><I name="PencilLine"/>改写文案</button><button class="warm" :disabled="!!busy||!d.rewrite" @click="textAction('legal')"><I name="ShieldCheck"/>AI法务</button></div><p v-if="rewritePrompt.source?.kind==='reference-visible'" class="rewrite-prompt-note">按上方指定字数扩写或精简，优先于模板默认长度。字数含标点；不新增未经确认的产品参数。</p><label class="rewrite-requirements">改写要求（选填）<textarea v-model="d.rewriteRequirements" aria-label="改写要求" rows="2" placeholder="例如：面向餐饮店老板，工厂实拍口吻，讲清板面、厚度和清理细节。" maxlength="4000"></textarea></label></article><div class="two-columns rewrite-columns"><article class="card text-card"><h3>原文案</h3><textarea v-model="d.sourceText" class="large-text" aria-label="改写原文案" placeholder="输入原文案"></textarea></article><article class="card text-card"><div class="card-heading"><h3>改写内容</h3><button class="text-button" @click="confirmCopy">确认使用</button></div><textarea v-model="d.rewrite" class="large-text" aria-label="改写内容" placeholder="模型生成的文案将在这里显示，也可以手动编辑"></textarea><span class="word-count">{{d.rewrite.length}} 字</span></article></div></template>
      <VoicePanel v-else-if="activeStep===2" @choose="(kind,assign,title)=>choose(kind,assign,title)" @generate="generate('speech','voice.audioId')" @translate="textAction('translate')"/>
      <VideoPanel v-else-if="activeStep===3" @choose="(kind,assign,title)=>choose(kind,assign,title)" @generate="generate('avatar','video.assetId')"/>
      <template v-else-if="activeStep===4"><div class="source-bar"><div class="edit-source-description"><small>视频源</small><div class="edit-source-file"><strong :title="currentAsset?.name">{{currentAsset?.name||'自动使用上一步数字人视频或手动选择'}}</strong><button class="pill" title="更换视频后，原字幕会保留到字幕历史" @click="choose('video',selectVideoSource,'选择剪辑视频')">修改</button></div></div><div class="edit-source-actions"><button :disabled="!!busy||!sourceVideo" :aria-busy="subtitleGenerating" @click="transcribe"><I v-if="subtitleGenerating" name="LoadingOutlined" :size="14"/>{{subtitleGenerating?'生成字幕中...':'生成字幕'}}</button><button :disabled="!!busy||!sourceVideo" @click="openSubtitleEditor">编辑字幕</button><button class="primary" :disabled="!!busy||!sourceVideo" :aria-busy="videoEditing" @click="generate('render','edit.resultId')"><I v-if="videoEditing" name="LoadingOutlined" :size="14"/>{{videoEditing?'剪辑中...':'剪辑视频'}}</button></div></div><div class="edit-columns"><EditModuleNav v-model="editTab" :title-summary="titleSummary" :subtitle-summary="subtitleSummary"/><article class="card edit-controls"><template v-if="editTab==='params'"><h3>音视频参数</h3><p class="edit-parameter-summary">{{d.edit.volume.toFixed(1)}} 人声 · {{d.edit.speed.toFixed(2)}}x</p><label class="edit-parameter-row"><span>人声音量</span><input v-model.number="d.edit.volume" aria-label="人声音量" type="range" min="0" max="3" step="0.05"/><output>{{d.edit.volume.toFixed(1)}}</output></label><label class="edit-parameter-row"><span>BGM音量</span><input v-model.number="d.edit.bgmVolume" aria-label="BGM音量" type="range" min="0" max="1" step="0.01"/><output>{{d.edit.bgmVolume.toFixed(1)}}</output></label><label class="edit-parameter-row"><span>视频倍速</span><select v-model.number="d.edit.speed" aria-label="视频倍速"><option v-for="speed in [0.5,0.75,1,1.25,1.5,2]" :key="speed" :value="speed">{{speed}}x</option><option v-if="![0.5,0.75,1,1.25,1.5,2].includes(d.edit.speed)" :value="d.edit.speed">{{d.edit.speed}}x</option></select><output>{{d.edit.speed}}x</output></label><label class="check-row edit-cut-row"><input v-model="d.edit.cutSilence" type="checkbox"/><span>智能剪气口</span><small>自动移除静音片段，增强短视频节奏</small></label><template v-if="d.edit.cutSilence"><label>静音阈值 {{d.edit.silenceThreshold}} dB<input v-model.number="d.edit.silenceThreshold" type="range" min="-80" max="-10" step="1"/></label><div class="two-fields"><label>最短静音（秒）<input v-model.number="d.edit.silenceMinimum" type="number" min="0.1" max="3" step="0.05"/></label><label>两侧保留（秒）<input v-model.number="d.edit.silencePadding" type="number" min="0" max="0.4" step="0.01"/></label></div><button :disabled="!!busy||!sourceVideo" @click="analyzeSilence">检测气口并预估时长</button><p v-if="silenceReport" class="hint">上次检测：裁掉{{silenceReport.removedDuration.toFixed(2)}}秒，保留{{silenceReport.keep.length}}段。渲染时按当前参数重新检测。</p></template><p class="hint">剪气口同步裁切画面和音轨，字幕按裁切结果调整时间。原视频保留在素材库。</p></template><TitlePanel v-else-if="editTab==='title'"/><SubtitlePanel v-else-if="editTab==='subtitles'" @import="choose('text',importCaption,'导入SRT字幕')" @timeline="openSubtitleEditor"/><NamecardPanel v-else-if="editTab==='card'"/><BgmPanel v-else-if="editTab==='bgm'"/><template v-else-if="editTab==='sfx'"><h3>{{editTab==='bgm'?'背景音乐':'音效'}}</h3><button class="secondary full" @click="choose('audio',a=>d.edit[editTab+'Id']=a.id,'选择音频素材')"><I name="Music"/>选择音频</button><p class="hint">{{state.assets.find(a=>a.id===d.edit[editTab+'Id'])?.name||'未选择音频'}}</p><label v-if="editTab==='bgm'">背景音量 {{d.edit.bgmVolume}}<input v-model.number="d.edit.bgmVolume" type="range" min="0" max="1" step="0.01"/></label></template><PipPanel v-else @custom="openPip" @choose="choose('visual',a=>d.edit.pipId=a.id,'选择画中画视频或图片')"/></article><EditPreview/></div></template>
      <CoverEditor ref="coverEditor" v-else-if="activeStep===5" @choose="(kind,assign,title)=>choose(kind,assign,title)"/>
      <template v-else><PublishPanel @choose="(kind,assign,title)=>choose(kind,assign,title)" @export="exportPack"/><ProductionReview :key="d.id"/></template>
    </section>
    <WorkflowStatus/><footer class="workflow-footer"><div class="progress-track"><div :style="{width:((activeStep+1)/7*100)+'%'}"></div></div><div class="footer-actions"><button class="previous" :disabled="activeStep===0||stepNavigating" @click="goStep(activeStep-1)">上一步</button><OperationStatus v-if="(busy||activeRecognition)&&!extractionOwnsStatus" inline/><div v-else class="step-status" :class="{ready:status.includes('已')}"><span></span>{{status}}<small v-if="activeStep<2">{{(d.rewrite||d.sourceText).slice(0,40)}}</small></div><button class="primary next" :disabled="activeStep===6||workflowLocked||!!busy||stepNavigating" @click="next">{{activeStep===5&&!d.cover.assetId?"生成封面并下一步":"下一步"}}</button></div></footer>
  </section>
  <AssetPicker v-if="picker" :kind="picker.kind" :title="picker.title" @close="picker=null" @select="selected"/>
  <PipEditor v-if="pipModal" :key="d.id+sourceVideo" :captions="d.edit.captions" :saving="pipSaving" @close="pipModal=false" @confirm="confirmPip"/>
  <Modal v-if="legal" title="AI法务 · 文案检查建议" wide @close="legal=''"><p class="pre-wrap">{{legal}}</p><p class="hint">这是模型生成的内容检查建议，需要人工核对。</p></Modal>
  <CaptionEditor v-if="subtitleModal" :session="captionSession" @close="subtitleModal=false" @import="choose('text',importCaption,'导入SRT字幕')"/>
</div>
</template>
