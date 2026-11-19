<script setup>
import {ref,computed,watch,onMounted,onUnmounted,provide} from 'vue';
import I from './components/Icon.vue';
import Modal from './components/Modal.vue';
import Workflow from './views/Workflow.vue';
import LegacyWorkflow from './views/LegacyWorkflow.vue';
import Resources from './views/Resources.vue';
import SettingsView from './views/SettingsView.vue';
import TaskCenter from './views/TaskCenter.vue';
import {call,pickFiles} from './api';
import OperationStatus from './components/OperationStatus.vue';
import LocalEnvironment from './components/LocalEnvironment.vue';
import {localEnvironmentSummary,localEnvironmentBusy} from './local-environment-ui.mjs';
import {applyTypography} from './typography.mjs';
import {workflowView} from '../server/workflow-view.mjs';
import {copySourceChanged} from '../server/copy-confirmation.mjs';
const state=ref(null),draft=ref(null),page=ref('workflow'),view=ref('new'),menu=ref(false),busy=ref(''),toast=ref(null),dialog=ref(null),saveState=ref('已保存');
const desktop=window.studio;
const environmentDialog=ref(false);
const settingsInitialTab=ref('general');
const environmentLabel=computed(()=>localEnvironmentSummary(state.value?.localEnvironment));
async function openEnvironmentSettings(){environmentDialog.value=false;settingsInitialTab.value='models';await navigate('settings');}
let environmentPolledAt=0;
// 子编辑器先保存自己的版本化数据，再由主草稿保存页面和任务选择。
const draftFlushers=new Set();
function registerDraftFlusher(flush){draftFlushers.add(flush);return ()=>draftFlushers.delete(flush);}
const pageHistory=ref([]);
const backTarget=computed(()=>pageHistory.value.at(-1)||{page:'workflow',view:view.value});
const backLabel=computed(()=>backTarget.value.page==='workflow'?(backTarget.value.view==='old'?'旧工作流':'新工作流'):({voices:'声音管理',avatars:'形象管理',assets:'素材管理',tasks:'任务中心',accounts:'账号管理',settings:'设置',help:'帮助'}[backTarget.value.page]||'工作流'));
let applyingSavedDraft=false;
watch(()=>({id:draft.value?.id,sourceText:draft.value?.sourceText,rewrite:draft.value?.rewrite}),(next,before)=>{if(!applyingSavedDraft&&before?.id&&before.id===next.id&&copySourceChanged(before,next))draft.value.confirmed=false;},{flush:'sync'});
const currentWorkflow=computed(()=>{const job=state.value?.workflowJobs?.find(job=>job.draftId===draft.value?.id);if(!job)return null;const summary=state.value.taskSummaries?.find(task=>task.id===draft.value.id),saved=state.value.drafts.find(task=>task.id===draft.value.id),available=(id,type)=>{if(!id)return false;const stage=type==='image'?summary?.stages[5]:summary?.stages[4],savedId=type==='image'?saved?.cover.assetId:saved?.edit.resultId;if(id===savedId)return !!stage?.available;return state.value.assets.some(asset=>asset.id===id&&asset.type===type&&asset.size>0);};return {...job,view:workflowView(job,draft.value,{available,unsettled:summary?.unknownRuns.length?'unknown':summary?.activeRun?'running':''})};});
const workflowLocked=computed(()=>['queued','running','stopping'].includes(currentWorkflow.value?.status));
watch(()=>state.value?.settings.fontSize,value=>applyTypography(value),{immediate:true});
let saveTimer,toastTimer,pollTimer;let chain=Promise.resolve();let lastSaved='';
const core=d=>JSON.stringify(d?{...d,updatedAt:undefined}:null);
function notify(message,type='info'){toast.value={message,type};clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.value=null,7000);}
function dismissTransientNotice(){if(toast.value&&toast.value.type!=='error'){toast.value=null;clearTimeout(toastTimer);}}
async function refresh(replace=false){const data=await call('state');state.value=data;environmentPolledAt=Date.now();if(replace||!draft.value||core(draft.value)===lastSaved){const id=replace?data.currentId:draft.value?.id||data.currentId;applyingSavedDraft=true;try{draft.value=structuredClone(data.drafts.find(d=>d.id===id));}finally{applyingSavedDraft=false;}lastSaved=core(draft.value);}return data;}
async function save(){for(const flush of [...draftFlushers])await flush();clearTimeout(saveTimer);if(!draft.value)return;const snapshot=JSON.parse(JSON.stringify(draft.value));if(core(snapshot)===lastSaved)return;saveState.value='保存中…';const job=chain.then(async()=>{const saved=await call('saveDraft',snapshot);if(draft.value?.id===saved.id&&core(draft.value)===core(snapshot)){lastSaved=core(saved);draft.value=saved;}saveState.value='已保存';});chain=job.catch(e=>{saveState.value='保存失败';notify(e.message,'error');});await job;}
watch(()=>core(draft.value),value=>{if(!draft.value||value===lastSaved)return;clearTimeout(saveTimer);saveState.value='待保存';saveTimer=setTimeout(()=>save().catch(()=>{}),500);});
async function act(label,fn){if(workflowLocked.value){notify('自动流程正在执行，请先停止后手动生成');return;}if(busy.value){notify('当前操作尚未结束，请稍候');return;}busy.value=label;try{await save();const result=await fn();await refresh();return result;}catch(e){await refresh().catch(()=>{});notify(e.message,'error');return undefined;}finally{busy.value='';}}
async function importAssets(kind){try{const assets=await pickFiles(kind);if(assets.length){await refresh();notify('已导入 '+assets.length+' 个文件','success');}return assets;}catch(e){notify(e.message,'error');return [];}}
async function newTask(){if(busy.value){notify('请等待当前任务完成');return;}await save();await call('newDraft');await refresh(true);pageHistory.value=[];page.value='workflow';notify('已创建新任务','success');}
async function selectTask(id){await save();await call('selectDraft',{id});await refresh(true);pageHistory.value=[];page.value='workflow';}
async function navigate(id){menu.value=false;await save();if(id==='tasks')await refresh();if(id==='new'||id==='old'){pageHistory.value=[];view.value=id;page.value='workflow';}else if(id!==page.value){pageHistory.value.push({page:page.value,view:view.value});page.value=id;}}
async function goBack(){menu.value=false;try{await save();const target=backTarget.value;if(target.page==='tasks')await refresh();pageHistory.value.pop();view.value=target.view;page.value=target.page;}catch(error){notify(error.message,'error');}}
function showDialog(title,message){dialog.value={title,message};}
const stepNames=['学习对标','改写文案','声音生成','视频生成','网感剪辑','标题封面','一键发布'];
const activeRecognition=computed(()=>state.value?.runs.find(run=>run.status==='running'&&['reference-analysis','reference-script','rewrite','legal','translate','title','marketing','topic','extract','transcribe','subtitle-auxiliary','brain-study','brain-review','brain-topics','brain-copies','copy-topics','copy-topic-candidates','copy-marketing-candidates','material-analysis','render','avatar','avatar-optimize','avatar-background','speech','speech-test','voice-import','voice-preview','voice-trim','voice-recording','voice-design','story-split-episodes','story-split-shots','story-extract-assets','story-image','story-video','story-compose'].includes(run.type)));
const stopping=ref(false),stopRequestedId=ref('');
const stopPending=computed(()=>stopping.value||!!activeRecognition.value&&(stopRequestedId.value===activeRecognition.value.id||!!activeRecognition.value.cancelRequestedAt));
watch(()=>activeRecognition.value?.id,()=>{stopRequestedId.value='';});
async function stopRecognition(){if(!activeRecognition.value||stopPending.value)return;const id=activeRecognition.value.id;stopping.value=true;stopRequestedId.value=id;try{await call('cancelRun',{id});await refresh();}catch(e){stopRequestedId.value='';notify(e.message,'error');}finally{stopping.value=false;}}
async function startWorkflow(mode=draft.value.mode||'auto',expectedId=draft.value.id){if(busy.value||workflowLocked.value)return;try{await save();if(draft.value.id!==expectedId){notify('任务已变化，未启动其他任务的自动流程');return;}await call('startWorkflow',{id:expectedId,mode});await refresh(true);notify(mode==='background'?'已创建后台任务，可继续查看其他页面':'已启动自动串行处理','success');}catch(error){notify(String(error.message).replace(/^Error invoking remote method '[^']+': (?:Error: )?/u,''),'error');}}
async function stopWorkflow(){if(!currentWorkflow.value)return;try{await call('stopWorkflow',{jobId:currentWorkflow.value.id});await refresh();notify('已请求停止流程，远程结果仍按实际状态保留');}catch(error){notify(error.message,'error');}}
provide('studio',{registerDraftFlusher,currentWorkflow,workflowLocked,startWorkflow,stopWorkflow,activeRecognition,stopPending,stopRecognition,state,draft,busy,notify,dismissTransientNotice,act,refresh,save,importAssets,showDialog,selectTask,newTask,navigate,stepNames});
onMounted(async()=>{try{await refresh(true);view.value=state.value.settings.view||'new';}catch(e){notify(e.message,'error');}pollTimer=setInterval(()=>{if(localEnvironmentBusy(state.value?.localEnvironment)||(state.value?.localEnvironment&&Date.now()-environmentPolledAt>=15000)||busy.value||activeRecognition.value||state.value?.runs?.some(r=>r.type==='publish'&&['running','queued'].includes(r.status))||state.value?.avatarQueryRunIds?.length||state.value?.workflowJobs?.some(job=>['queued','running','stopping'].includes(job.status))||state.value?.accounts?.some(account=>['waiting_login','connected'].includes(account.connection?.status)))refresh().catch(()=>{});},2000);});
onUnmounted(()=>{clearInterval(pollTimer);clearTimeout(saveTimer);});
const menuItems=[['new','新工作流','House'],['old','旧工作流','FlaskConical'],['voices','声音管理','Volume2'],['avatars','形象管理','Video'],['assets','素材管理','FolderOpen'],['tasks','任务中心','List'],['accounts','账号管理','Users'],['settings','设置','Settings'],['help','帮助','HelpCircle']];
</script>
<template>
  <div class="app" :data-size="state?.settings.fontSize||'comfortable'" :data-theme="state?.settings.theme||'default'">
    <header class="titlebar"><div class="brand"><span class="brand-symbol"><I name="Play" :size="23"/></span><strong>轻语IP</strong></div><div class="titlebar-spacer"></div><button v-if="state" class="environment-title-button" :class="state.localEnvironment?.status" :title="environmentLabel+'，点击查看详情'" :aria-label="environmentLabel+'，查看本地环境'" @click="environmentDialog=true"><I :name="localEnvironmentBusy(state.localEnvironment)?'LoaderCircle':'Monitor'" :class="{spin:localEnvironmentBusy(state.localEnvironment)}" :size="16"/><span>{{environmentLabel}}</span></button><div class="top-menu"><button :aria-expanded="menu" @click="menu=!menu"><I name="Grid2X2" :size="16"/> 菜单 <I name="ChevronDown" :size="15"/></button><nav v-if="menu" aria-label="主菜单"><button v-for="[id,label,icon] of menuItems" :key="id" :class="{active:(page==='workflow'&&id===view)||id===page,separator:['voices','accounts'].includes(id)}" @click="navigate(id)"><I :name="icon"/><span>{{label}}</span></button></nav></div><button class="user-button" @click="showDialog('本地用户','当前为独立本地工作台。模型服务请在设置中配置，发布平台账号需要单独连接。')"><span class="avatar">L</span>本地用户<I name="ChevronDown" :size="15"/></button><div class="window-actions"><button aria-label="最小化" @click="desktop?.window('minimize')"><I name="Minus" :size="18"/></button><button aria-label="最大化或还原" @click="desktop?.window('maximize')"><I name="Square" :size="16"/></button><button class="close" aria-label="关闭窗口" @click="desktop?.window('close')"><I name="X" :size="20"/></button></div></header>
    <main v-if="state&&draft" :class="{'management-main':page!=='workflow'}" @click="menu=false"><nav v-if="page!=='workflow'" class="page-navigation" aria-label="页面导航"><button class="page-back" :title="'返回'+backLabel" :aria-label="'返回'+backLabel" @click="goBack"><I name="ArrowLeft" :size="18"/><span>返回{{backLabel}}</span></button></nav><Workflow v-if="page==='workflow'&&view==='new'" :view="view"/><LegacyWorkflow v-else-if="page==='workflow'"/><SettingsView v-else-if="page==='settings'" :initial-tab="settingsInitialTab"/><TaskCenter v-else-if="page==='tasks'"/><div v-else-if="page==='help'" class="help-page"><h1>使用帮助</h1><article class="card"><h2>从文案到视频，按步骤完成创作</h2><ol><li>学习对标：导入或填写原文，建立任务。</li><li>改写文案：配置模型后生成，或直接填写并确认最终文案。</li><li>声音生成：选择服务音色，或导入已有音频。</li><li>视频生成：接入口型服务，或导入已有视频进入剪辑。</li><li>网感剪辑：导入SRT字幕，配置标题、音量与背景音乐，生成实际视频。</li><li>标题封面：调整模板、背景、文字与遮罩，导出PNG封面。</li><li>一键发布：编辑发布信息，导出发布包。平台连接完成后再进行发布验收。</li></ol><p>模型未配置时不会返回模拟结果。任务和资源保存在本地，原软件保持独立。</p><button class="primary" @click="navigate('settings')">配置模型与媒体工具</button></article><article class="card"><h2>参考与开发进度</h2><p>本地版本 0.1.0 · 参考界面 轻语IP 8.4.0</p><p>拆解证据、教程采样和实现设计已保存在项目的 docs 与 evidence 目录中。</p></article></div><Resources v-else :page="page"/></main>
    <div v-else class="startup"><I name="LoaderCircle" :size="32" class="spin"/><p>正在读取本地工作台…</p><button @click="refresh(true).catch(e=>notify(e.message,'error'))">重新读取</button></div>
    <div v-if="toast" class="toast" :class="toast.type" role="status"><I :name="toast.type==='error'?'ShieldCheck':'CheckCircle2'" :size="20"/><span>{{toast.message}}</span><button aria-label="关闭提示" @click="toast=null"><I name="X" :size="16"/></button></div>
    <OperationStatus v-if="!(state&&draft&&page==='workflow'&&view==='new')"/>
    <Modal v-if="environmentDialog" title="本地运行环境" wide variant="environment" @close="environmentDialog=false"><LocalEnvironment @settings="openEnvironmentSettings"/><template #footer><button @click="environmentDialog=false">关闭</button></template></Modal>
    <Modal v-if="dialog" :title="dialog.title" @close="dialog=null"><p class="dialog-message">{{dialog.message}}</p><template #footer><button class="primary" @click="dialog=null">知道了</button></template></Modal>
  </div>
</template>


<style>
.environment-title-button{flex-shrink:0;max-width:190px;margin-right:12px;padding:7px 10px;font-size:var(--app-font-size-meta);border-color:#494357;background:#292936}.environment-title-button span{overflow:hidden;text-overflow:ellipsis}.environment-title-button.degraded{color:#ffbdac;border-color:#805a5b}.environment-title-button.ready{color:#a9ddc9}.environment-modal{width:760px!important;max-height:calc(100dvh - 60px)}.environment-modal>.modal-body{min-height:0;overflow:auto;scrollbar-gutter:stable}@media(max-width:1150px){.environment-title-button{max-width:168px;margin-right:8px}}
</style>
