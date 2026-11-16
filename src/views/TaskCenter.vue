<script setup>
import {h3ActivityText} from '../../server/h3-activity.mjs';
import {inject,ref,computed,watch} from 'vue';
import I from '../components/Icon.vue';
import Modal from '../components/Modal.vue';
import {call} from '../api';

const {state,draft,selectTask,newTask,notify,stepNames,refresh,busy,save}=inject('studio');
const search=ref(''),tab=ref('drafts'),filter=ref('all'),mode=ref('all');
const appliedFilter=ref('all'),appliedMode=ref('all'),detailTaskId=ref(''),detailRunId=ref(''),deleting=ref(null),removing=ref(false);
const pageNumber=ref(1),pageSize=ref(10);
const queryingRun=ref(''),queryError=ref(''),queryMessage=ref('');
const querying=id=>queryingRun.value===id||state.value.avatarQueryRunIds?.includes(id);
const anyQuerying=computed(()=>!!queryingRun.value||!!state.value.avatarQueryRunIds?.length);
const taskLabels={pending:'待处理',running:'处理中',succeeded:'已完成',failed:'失败',unknown:'待确认',interrupted:'已中断',cancelled:'已取消'};
const labels={running:'运行中',queued:'排队中',succeeded:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断',unknown:'远程状态待确认'};
const types={rewrite:'文案改写',legal:'文案检查',topic:'选题生成',marketing:'营销文案',speech:'声音生成','speech-test':'配音测试','voice-import':'保存声音样本','voice-preview':'读取声音波形','voice-trim':'裁剪声音样本','voice-training':'声音训练',avatar:'视频生成',render:'视频剪辑',frame:'截取封面',extract:'提取文案',transcribe:'语音识别',title:'标题生成',translate:'翻译','cover-video':'生成封面视频','silence-analysis':'检测静音',publish:'视频发布',cover:'封面图片','publish-metadata':'发布信息','material-analysis':'素材视觉标记'};
const summaries=computed(()=>state.value.taskSummaries||[]);
const records=computed(()=>state.value.runs.filter(run=>(appliedFilter.value==='all'||run.status===appliedFilter.value)&&((types[run.type]||run.type)+' '+run.id+' '+(summaries.value.find(task=>task.id===run.draftId)?.title||'')).toLowerCase().includes(search.value.trim().toLowerCase())));
const tasks=computed(()=>summaries.value.filter(task=>(appliedFilter.value==='all'||task.status===appliedFilter.value)&&(appliedMode.value==='all'||task.mode===appliedMode.value)&&(task.title+' '+task.id).toLowerCase().includes(search.value.trim().toLowerCase())));
const filteredItems=computed(()=>tab.value==='drafts'?tasks.value:records.value);
const pageCount=computed(()=>Math.max(1,Math.ceil(filteredItems.value.length/pageSize.value)));
const pageItems=computed(()=>filteredItems.value.slice((pageNumber.value-1)*pageSize.value,pageNumber.value*pageSize.value));
const detailTask=computed(()=>summaries.value.find(task=>task.id===detailTaskId.value));
const detailWorkflows=computed(()=>state.value.workflowJobs?.filter(job=>job.draftId===detailTaskId.value)||[]);
const jobLabels={queued:'排队中',running:'处理中',stopping:'正在停止',failed:'失败',cancelled:'已取消',unknown:'远程待确认',interrupted:'已中断',awaiting_publish:'成片就绪，待发布'};
const stageLabels={pending:'待处理',running:'处理中',succeeded:'已完成',reused:'复用已有结果',skipped:'跳过',waiting:'等待发布',failed:'失败',cancelled:'已取消',unknown:'远程待确认',interrupted:'已中断'};
const detailRun=computed(()=>state.value.runs.find(run=>run.id===detailRunId.value));
const stats=computed(()=>[
  {icon:'📝',label:'总任务',value:summaries.value.length},
  {icon:'⚙️',label:'进行中',value:summaries.value.filter(task=>task.status==='running').length},
  {icon:'✅',label:'已完成',value:summaries.value.filter(task=>task.status==='succeeded').length},
  {icon:'❌',label:'失败',value:summaries.value.filter(task=>task.status==='failed').length},
]);
const uncertainCount=computed(()=>summaries.value.filter(task=>['unknown','interrupted','cancelled'].includes(task.status)).length);
const time=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('zh-CN',{hour12:false}):'—';
function applyFilters(){appliedFilter.value=filter.value;appliedMode.value=mode.value;pageNumber.value=1;}
function clearFilters(){filter.value='all';mode.value='all';appliedFilter.value='all';appliedMode.value='all';search.value='';pageNumber.value=1;}
watch([search,pageSize],()=>pageNumber.value=1);
watch(tab,clearFilters);
watch(detailRunId,()=>{queryError.value='';queryMessage.value='';});
watch(pageCount,count=>pageNumber.value=Math.min(pageNumber.value,count));
async function refreshTasks(){try{await refresh();}catch(error){notify('刷新失败：'+error.message,'error');}}
async function continueTask(task){try{await selectTask(task.id);}catch(error){notify(error.message,'error');}}
async function stopJob(job){try{await call('stopWorkflow',{jobId:job.id});await refresh();}catch(error){notify(error.message,'error');}}
async function stopRun(run){try{await call('cancelRun',{id:run.id});await refresh();notify('已请求停止；带远程ID的执行结果仍需确认');}catch(error){notify(error.message,'error');}}
async function queryRemote(run,continueSequence=false){
  if(anyQuerying.value||busy.value)return;const id=run.id;queryingRun.value=id;queryError.value='';queryMessage.value='';
  try{
    await save();const pending=call(continueSequence?'continueAvatarSegments':'queryAvatarResult',{runId:id});pending.catch(()=>{});await refresh();const result=await pending;await save();await refresh();
    if(result.status==='succeeded')result.attached=state.value.drafts.find(d=>d.id===run.draftId)?.video.assetId===result.asset.id;
    const message=result.status==='awaiting_continue'?'已保留完成片段；点击“继续分段生成”提交后续片段或重试已确认失败段。'+(result.error||''):result.status==='pending'?'远程任务仍在处理，'+(h3ActivityText(state.value.runs.find(item=>item.id===id)?.activity)||'等待原任务返回状态')+'，可稍后再次查询。':result.status==='succeeded'?(result.attached?'视频已取回并绑定原任务，请检查口型和音画同步。':'视频已取回素材库；原输入或当前产物已变化，未替换任务视频。'):result.status==='failed'?'远程服务已确认生成失败，可在核对原因后重新生成。':'远程服务已确认任务取消。';
    if(detailRunId.value===id)queryMessage.value=message;notify(message,result.status==='failed'?'error':'success');
  }catch(error){if(detailRunId.value===id)queryError.value=error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');await refresh().catch(()=>{});}
  finally{if(queryingRun.value===id)queryingRun.value='';}
}
async function remove(){
  if(removing.value||busy.value)return;
  removing.value=true;
  try{
    const id=deleting.value.id;
    await call('deleteDraft',{id});
    await refresh(draft.value.id===id);
    if(detailTaskId.value===id)detailTaskId.value='';
    deleting.value=null;
    notify('任务及执行记录已删除，素材仍保留在素材库','success');
  }catch(error){notify(error.message,'error');}finally{removing.value=false;}
}
</script>

<template>
  <section class="management-page task-page">
    <div class="management-title">
      <div><h1><span aria-hidden="true">📊</span>任务中心</h1><p>这里存储创作任务；移动或删除素材文件后，当前产物可能失效。状态和进度按当前内容与产物更新。</p></div>
      <div class="toolbar task-title-actions">
        <button @click="tab=tab==='drafts'?'runs':'drafts'">{{tab==='drafts'?'执行记录':'创作任务'}}</button>
        <button :disabled="!!busy" @click="refreshTasks"><I name="RefreshCw"/>刷新</button>
        <button class="primary" :disabled="!!busy" @click="newTask"><I name="Plus"/>新建任务</button>
      </div>
    </div>
    <div class="stat-grid"><article v-for="stat in stats" :key="stat.label" class="card"><span class="task-stat-icon" aria-hidden="true">{{stat.icon}}</span><span>{{stat.label}}</span><strong>{{stat.value}}</strong></article></div>
    <div class="toolbar task-filterbar">
      <strong class="task-filter-title"><I name="Search"/>筛选条件</strong>
      <select v-model="filter" aria-label="筛选任务状态"><option value="all">任务状态</option><option v-for="(label,key) in tab==='drafts'?taskLabels:labels" :key="key" :value="key">{{label}}</option></select>
      <select v-if="tab==='drafts'" v-model="mode" aria-label="筛选执行模式"><option value="all">执行模式</option><option value="manual">手动</option><option value="auto">自动</option><option value="background">后台</option></select>
      <button class="task-filter-apply" @click="applyFilters">筛选</button><button @click="clearFilters">清空</button>
      <div class="spacer"></div><div class="search"><I name="Search" :size="16"/><input v-model="search" placeholder="搜索任务" aria-label="搜索任务"/></div>
    </div>
    <p v-if="uncertainCount" class="task-attention">另有 {{uncertainCount}} 个任务待确认、已中断或已取消，可通过状态筛选查看。</p>
    <article class="card task-table">
      <div class="task-table-scroll">
        <table v-if="tab==='drafts'" class="draft-task-table">
          <colgroup><col class="task-name-col"/><col class="task-status-col"/><col class="task-progress-col"/><col class="task-stage-col"/><col class="task-date-col"/><col class="task-actions-col"/></colgroup>
          <thead><tr><th>任务标题</th><th>状态</th><th>进度</th><th>当前步骤</th><th>创建时间</th><th>操作</th></tr></thead>
          <tbody><tr v-for="task in pageItems" :key="task.id" :data-task-id="task.id">
            <td><div class="task-title-cell"><strong :title="task.title">{{task.title}}</strong><span class="task-mode-badge">{{task.modeLabel}}</span></div></td>
            <td><span class="task-status-badge" :class="task.status">{{task.statusLabel}}</span></td>
            <td><div class="task-progress" role="progressbar" :aria-label="task.title+'进度'" :aria-valuenow="task.progress" aria-valuemin="0" aria-valuemax="100"><span class="task-progress-track"><i :style="{width:task.progress+'%'}"></i></span><span>{{task.progress}}%</span></div></td>
            <td><span class="task-step-badge">{{task.currentStepName}}</span></td><td>{{time(task.createdAt)}}</td>
            <td><div class="task-row-actions"><button class="primary" :disabled="!!busy" @click="continueTask(task)">继续</button><button @click="detailTaskId=task.id">详情</button><button class="task-delete-button" :disabled="!task.deletable||!!busy" :title="task.deletable?'删除任务':'执行尚未结束或远程结果待确认'" @click="deleting=task">删除</button></div></td>
          </tr></tbody>
        </table>
        <table v-else class="execution-task-table"><thead><tr><th>执行类型</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody><tr v-for="run in pageItems" :key="run.id"><td>{{types[run.type]||run.type}}<small>{{run.id.slice(0,8)}}</small></td><td><span class="badge" :class="run.status">{{labels[run.status]}}</span><small v-if="run.status==='running'&&run.activity" class="run-model-activity">{{h3ActivityText(run.activity)}}</small><div v-else-if="run.status==='running'" class="mini-progress"><span :style="{width:run.progress+'%'}"></span></div></td><td>{{time(run.createdAt)}}</td><td><button @click="detailRunId=run.id">详情</button><button v-if="run.status==='running'" class="text-button danger" @click="stopRun(run)">停止</button></td></tr></tbody></table>
      </div>
      <div v-if="!filteredItems.length" class="task-list-empty"><I name="List" :size="34"/><p>{{tab==='drafts'?'暂无符合条件的任务':'暂无符合条件的执行记录'}}</p></div>
      <footer class="task-pagination"><span>共 {{filteredItems.length}} 条记录</span><button class="icon-button" aria-label="上一页" :disabled="pageNumber<=1" @click="pageNumber--"><I name="ChevronDown" :size="16" class="page-prev-icon"/></button><span class="page-number">{{pageNumber}}</span><button class="icon-button" aria-label="下一页" :disabled="pageNumber>=pageCount" @click="pageNumber++"><I name="ChevronDown" :size="16" class="page-next-icon"/></button><select v-model.number="pageSize" aria-label="每页条数"><option v-for="size in [10,20,50]" :key="size" :value="size">{{size}} 条/页</option></select></footer>
    </article>
  </section>

  <Modal v-if="detailTask" title="任务详情" variant="task-detail" @close="detailTaskId=''">
    <section class="task-detail-section"><h3><I name="FileText"/>基本信息</h3><dl class="task-information-grid">
      <dt>任务ID</dt><dd><code :title="detailTask.id">{{detailTask.id}}</code></dd><dt>执行模式</dt><dd>{{detailTask.modeLabel}}（{{detailTask.mode}}）</dd>
      <dt>任务状态</dt><dd><span class="task-status-badge" :class="detailTask.status">{{detailTask.statusLabel}}</span></dd><dt>当前步骤</dt><dd><span class="task-step-badge">{{detailTask.currentStepName}}</span></dd>
      <dt>进度</dt><dd><div class="task-progress"><span class="task-progress-track"><i :style="{width:detailTask.progress+'%'}"></i></span><span>{{detailTask.progress}}%</span></div></dd><dt>创建时间</dt><dd>{{time(detailTask.createdAt)}}</dd>
      <dt>更新时间</dt><dd>{{time(detailTask.updatedAt)}}</dd><dt>正在查看页</dt><dd>{{stepNames[detailTask.viewedStep]}}</dd>
    </dl><p class="task-detail-note">进度 {{detailTask.completedStages}} / {{detailTask.totalStages}}：按当前就绪及明确跳过的阶段计算。本地导出包尚未发布。</p><p v-if="detailTask.workflow?.status==='stale'" class="task-detail-note workflow-current-note">{{detailTask.workflow.message}}下方保留历史执行记录。</p></section>
    <section v-if="detailWorkflows.length" class="task-detail-section"><h3>自动流程记录</h3><div class="workflow-job-history"><article v-for="job in detailWorkflows" :key="job.id"><h4>{{job.mode==='background'?'后台':'自动'}} · {{jobLabels[job.status]}} · {{job.phase}}</h4><p v-if="job.error" class="error-panel">{{job.error}}</p><button v-if="['queued','running','stopping'].includes(job.status)" :disabled="job.status==='stopping'" @click="stopJob(job)">停止流程</button><ol><li v-for="stage in job.stages" :key="stage.key">{{stage.name}}<span>{{stageLabels[stage.status]}}</span><small v-if="stage.reason"> · {{stage.reason}}</small><p v-if="stage.error" class="task-stage-error">{{stage.error}}</p><button v-if="stage.runId" class="text-button" @click="detailRunId=stage.runId">查看执行</button></li></ol></article></div></section>
    <section v-if="detailTask.unknownRuns.length" class="task-detail-section task-unknown"><h3>远程结果待确认</h3><p>这些执行仍保留远程ID，未确认前不能删除任务。</p><button v-for="run in detailTask.unknownRuns" :key="run.id" @click="detailRunId=run.id">查看 {{types[run.type]||run.type}} · {{run.remoteId||run.id}}</button></section>
    <section class="task-detail-section"><h3><I name="List"/>执行历史与当前产物</h3><ol class="task-stage-list"><li v-for="stage in detailTask.stages" :key="stage.key" :data-stage="stage.key"><article class="task-stage-card">
      <div class="task-stage-heading"><h4>{{stage.name}}</h4><span class="task-status-badge" :class="stage.status">{{stage.label}}</span></div>
      <p>{{stage.message}}</p><p v-if="stage.artifact" class="task-artifact-name">{{stage.artifact.name}}</p>
      <div v-if="stage.latest" class="task-stage-time"><I name="RefreshCw" :size="13"/><span>{{time(stage.latest.endedAt||stage.latest.createdAt)}}</span><button class="text-button" @click="detailRunId=stage.latest.id">查看执行</button></div>
      <details v-if="stage.history.length" class="task-stage-runs"><summary>执行记录（{{stage.history.length}} 次）</summary><div v-for="run in stage.history" :key="run.id"><button class="text-button" @click="detailRunId=run.id">{{types[run.type]||run.type}} · {{labels[run.status]||run.status}}</button><small>{{time(run.createdAt)}}</small><p v-if="run.error" class="task-stage-error">{{run.error}}</p></div></details>
    </article></li></ol></section>
    <template #footer><button @click="detailTaskId=''">关闭</button><button class="task-delete-button" :disabled="!detailTask.deletable||!!busy" @click="deleting=detailTask">删除任务</button></template>
  </Modal>

  <Modal v-if="detailRun" title="执行详情" wide @close="detailRunId=''">
    <dl class="run-details"><dt>执行ID</dt><dd>{{detailRun.id}}</dd><dt>状态</dt><dd>{{labels[detailRun.status]}}</dd><dt>{{detailRun.remote?.kind==='comfy-h3-sequence-v1'?'分段计划ID':'远程ID'}}</dt><dd>{{detailRun.remoteId||'无'}}</dd><dt>进度</dt><dd v-if="detailRun.activity">{{h3ActivityText(detailRun.activity)}}<small class="run-activity-time">最后观察：{{time(detailRun.activity.observedAt)}}{{detailRun.status!=='running'&&!querying(detailRun.id)?'（历史记录）':''}}</small></dd><dd v-else>{{detailRun.progress}}%</dd></dl>
    <p v-if="detailRun.error" class="error-panel">{{detailRun.error}}</p>
    <section v-if="detailRun.type==='avatar'&&detailRun.status==='unknown'" class="remote-recovery" :aria-busy="querying(detailRun.id)">
      <p v-if="detailRun.remote?.kind==='comfy-h3-sequence-v1'">查询只取回已提交片段；继续分段生成会沿原计划提交后续片段，已完成片段不重交。停止本地等待不会取消已提交的片段。</p><p v-else-if="detailRun.remote?.kind==='comfy-h3-v1'&&!detailRun.remoteId&&detailRun.remote?.clientId">先按提交标识和生成图查找本机原任务，再取回结果；没有唯一匹配时继续保留待确认。</p><p v-else-if="detailRun.remote?.statusUrl">查询已提交的远程任务；停止本地查询不会取消远程生成。</p><p v-else>该历史记录未保存完整查询凭据，结果仍待确认，不能直接重交。</p>
      <p v-if="detailRun.remote?.clientId||detailRun.failureOutput?.clientId">本地提交标识：<code>{{detailRun.remote?.clientId||detailRun.failureOutput?.clientId}}</code></p>
      <div class="remote-recovery-actions"><button class="primary" :disabled="anyQuerying||!!busy||!detailRun.remote?.statusUrl" @click="queryRemote(detailRun)">{{querying(detailRun.id)?'正在处理…':'查询远程结果'}}</button><button v-if="detailRun.remote?.kind==='comfy-h3-sequence-v1'" :disabled="anyQuerying||!!busy" @click="queryRemote(detailRun,true)">继续分段生成</button><button v-if="querying(detailRun.id)" @click="stopRun(detailRun)">停止等待</button></div>
    </section>
    <ol v-if="detailRun.remote?.kind==='comfy-h3-sequence-v1'" class="task-stage-list"><li v-for="segment in detailRun.remote.segments" :key="segment.index" class="task-stage-card"><div class="task-stage-heading"><strong><template v-if="detailRun.remote.plan.mode==='multi'">镜头 {{detailRun.remote.plan.segments[segment.index].shotIndex+1}} · </template>第 {{segment.index+1}} 段</strong><span>{{({planned:'待生成',submitting:'提交待确认',accepted:'已提交',succeeded:'已取回，质量待检查',failed:'已确认失败，可继续重试'})[segment.status]||segment.status}}</span></div><p>{{(detailRun.remote.plan.segments[segment.index].startSample/32000).toFixed(3)}} ～ {{(detailRun.remote.plan.segments[segment.index].endSample/32000).toFixed(3)}} 秒</p><p v-if="segment.remoteId">模型任务：{{segment.remoteId}}</p><p v-if="segment.error" class="error-panel">{{segment.error}}</p></li></ol>
    <p v-else-if="detailRun.status==='unknown'" class="hint">远程结果尚未确认，请保留任务ID查询，重复提交可能产生重复任务。</p>
    <p v-if="queryError" class="error-panel" role="alert">{{queryError}}</p><p v-if="queryMessage" class="remote-query-message" role="status">{{queryMessage}}</p>
    <details v-if="detailRun.unresolvedHistory" class="remote-recovery-history"><summary>原待确认记录</summary><p>{{detailRun.unresolvedHistory.error}}</p><p>原结束时间：{{time(detailRun.unresolvedHistory.endedAt)}}</p></details>
    <pre>{{JSON.stringify({parameters:detailRun.parameters,output:detailRun.output,activity:detailRun.activity,logs:detailRun.logs,remoteChecks:detailRun.remoteChecks},null,2)}}</pre>
    <template #footer><button @click="detailRunId=''">关闭</button></template>
  </Modal>
  <Modal v-if="deleting" title="删除创作任务" @close="!removing&&(deleting=null)"><p>删除“{{deleting.title}}”及其执行记录？素材文件仍会保留在素材库。</p><template #footer><button :disabled="removing" @click="deleting=null">取消</button><button class="danger-button" :disabled="removing||!!busy" @click="remove">{{removing?'删除中…':'删除'}}</button></template></Modal>
</template>
