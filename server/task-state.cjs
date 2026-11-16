const fs = require('node:fs');
const {workflowView,skippedVoice}=require('./workflow-view.mjs');

const definitions = [
  {key:'source', name:'提取文案', types:['extract','topic','marketing']},
  {key:'copy', name:'改写文案', types:['rewrite','translate']},
  {key:'voice', name:'声音生成', types:['speech']},
  {key:'video', name:'视频生成', types:['avatar']},
  {key:'edit', name:'视频剪辑', types:['render','transcribe','silence-analysis']},
  {key:'cover', name:'封面生成', types:['frame','cover-video','title']},
  {key:'publish', name:'视频发布', types:['publish']},
];
const labels = {pending:'待处理', running:'处理中', succeeded:'已完成', failed:'失败', unknown:'待确认', interrupted:'已中断', cancelled:'已取消'};
const runLabels = {running:'运行中', queued:'排队中', succeeded:'成功', failed:'失败', unknown:'远程待确认', interrupted:'已中断', cancelled:'已取消'};
const dateValue = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
const publicRun = run => run ? Object.fromEntries(['id','type','status','createdAt','endedAt','progress','error','remoteId'].map(key => [key,run[key]])) : null;

function summarizeTasks(data) {
  const assets = new Map(data.assets.map(asset => [asset.id,asset]));
  const availability = new Map();
  function assetState(id, type) {
    if (!id) return {available:false, reason:'尚未选择素材'};
    const key = id+':'+type;
    if (availability.has(key)) return availability.get(key);
    const asset = assets.get(id);
    let result = {available:false, reason:'素材记录不存在'};
    if (asset) {
      result = {id:asset.id, name:asset.name, available:false, reason:'素材类型不符'};
      if (asset.type === type) {
        try {
          const stat = fs.statSync(asset.path);
          result.available = stat.isFile() && stat.size > 0;
          result.reason = result.available ? '' : '素材文件为空或不是普通文件';
        } catch {
          result.reason = '素材文件不存在或不可读取';
        }
      }
    }
    availability.set(key,result);
    return result;
  }
  return data.drafts.map(draft => {
    const runs = data.runs.filter(run => run.draftId === draft.id).slice().sort((a,b) => dateValue(b.createdAt)-dateValue(a.createdAt));
    const workflow=(data.workflowJobs||[]).find(job=>job.draftId===draft.id),workflowRunning=workflow&&['queued','running','stopping'].includes(workflow.status);
    const voice = assetState(draft.voice.audioId,'audio');
    const video = assetState(draft.edit.sourceId || draft.video.assetId,'video');
    const edited = {...assetState(draft.edit.resultId,'video')};
    if(edited.available&&!require('./title-output.mjs').titleOutputCurrent(draft,assets.get(draft.edit.resultId))){edited.available=false;edited.reason='自定义标题排版版本已更新，请重新剪辑；历史视频仍保留';}
    if(edited.available&&!require('./subtitle-output.mjs').subtitleOutputCurrent(draft,assets.get(draft.edit.resultId))){edited.available=false;edited.reason='字幕模板生成规则已更新，请重新剪辑；历史视频仍保留';}
    if(edited.available&&!require('./pip-matching.cjs').pipResultCurrent(data,draft,assets.get(draft.edit.resultId))){edited.available=false;edited.reason='画中画匹配依据或源文件已变化，请重新剪辑';}
    const cover = assetState(draft.cover.assetId,'image');
    const workflowState=workflowView(workflow,draft,{available:(id,type)=>id===draft.edit.resultId&&type==='video'?edited.available:assetState(id,type).available,unsettled:runs.some(run=>run.status==='unknown')?'unknown':runs.some(run=>['running','queued'].includes(run.status))?'running':''});
    const voiceSkipped=skippedVoice(workflow,draft,video.available)&&!voice.available;
    const exported = data.publishRecords.find(record => record.id === draft.publish.recordId && record.draftId === draft.id && record.status === 'exported');
    const publication=data.publishRecords.find(record=>record.id===draft.publish.recordId&&record.draftId===draft.id&&['published','draft_saved'].includes(record.status)&&record.signature===require('./publish-jobs.cjs').signature(draft)&&Array.isArray(record.accounts)&&record.accounts.length===draft.publish.accountIds.length&&record.accounts.length>0&&draft.publish.accountIds.every(id=>record.accounts.filter(a=>a.id===id&&a.status==='succeeded'&&require('./publish-jobs.cjs').validEvidence(a.result,record.mode,a.submittedAt)).length===1));
    // 只有全部账号的本次平台确认与当前输入一致才完成发布，导出不计入。
    const ready = [!!draft.sourceText.trim(), !!draft.confirmed && !!draft.finalText.trim(), voice.available, video.available, edited.available, cover.available, !!publication];
    const messages = [
      ready[0] ? '当前已填写原文案，可来自输入、导入或模型结果。' : '等待原文案。',
      ready[1] ? '当前最终文案已确认。' : draft.rewrite.trim() || draft.finalText.trim() ? '已有文案，尚未确认使用。' : '等待最终文案确认。',
      ready[2] ? '当前配音素材可读取；不据此认定声音克隆效果。' : voice.reason,
      ready[3] ? (draft.edit.sourceId ? '当前为手动导入剪辑源，不代表已生成数字人。' : '当前视频素材可读取。') : video.reason,
      ready[4] ? '当前剪辑结果文件可读取。' : edited.reason,
      ready[5] ? '当前封面图片可读取。' : cover.reason,
      publication?(publication.mode==='draft'?'全部所选账号均已确认保存平台草稿。':'全部所选账号均已取得平台发布确认。'):exported ? '已导出本地发布包，尚未上传平台。' : '尚未取得平台发布确认。',
    ];
    const artifacts = [null,null,voice,video,edited,cover,null];
    const stages = definitions.map((definition,index) => {
      const history = runs.filter(run => definition.types.includes(run.type));
      const latest = history[0];
      const unsettled = history.find(run => ['running','queued','unknown'].includes(run.status));
      let status = ready[index] ? 'ready' : index===2&&voiceSkipped?'skipped':'pending';
      if (unsettled) status = unsettled.status;
      else if (status!=='skipped'&&!ready[index] && ['failed','interrupted','cancelled'].includes(latest?.status)) status = latest.status;
      let message = status==='skipped'?'本次自动流程使用手选视频，已跳过配音；没有生成音频。':messages[index];
      if (!ready[index] && latest?.status === 'succeeded') message += ' 历史成功记录仍保留，当前尚无符合就绪条件的内容或产物。';
      const label = runLabels[status] || (status==='skipped'?'已跳过':status === 'ready' ? ['已填写','已确认','已就绪','已就绪','已就绪','已就绪',publication?.mode==='draft'?'草稿已保存':'已发布'][index] : exported && index === 6 ? '已导出，待发布' : '待处理');
      return {key:definition.key, name:definition.name, index, status, label, available:ready[index], completed:ready[index]||status==='skipped', message, artifact:artifacts[index]?.id ? artifacts[index] : null, latest:publicRun(latest), unsettled:publicRun(unsettled), history:history.map(publicRun)};
    });
    const active = runs.find(run => ['running','queued'].includes(run.status));
    const unknown = runs.find(run => run.status === 'unknown');
    const failed = stages.find(stage => stage.status === 'failed');
    const interrupted = stages.find(stage => stage.status === 'interrupted');
    const cancelled = stages.find(stage => stage.status === 'cancelled');
    const completedStages = stages.filter(stage=>stage.completed).length;
    const hasInput = [draft.sourceText,draft.sourceUrl,draft.rewrite,draft.finalText,draft.brain.url,...Object.values(draft.marketing),draft.topic.industry,draft.topic.audience,draft.topic.bio].some(value => typeof value === 'string' && value.trim());
    let status = 'pending';
    if (workflowRunning) status = 'running';
    else if(workflow?.status==='unknown')status='unknown';
    else if(workflow?.status==='failed')status='failed';
    else if(workflow?.status==='interrupted')status='interrupted';
    else if(workflow?.status==='cancelled')status='cancelled';
    else if (active) status = 'running';
    else if (unknown) status = 'unknown';
    else if (failed) status = 'failed';
    else if (interrupted) status = 'interrupted';
    else if (cancelled) status = 'cancelled';
    else if (completedStages === stages.length) status = 'succeeded';
    else if (completedStages || hasInput || runs.length) status = 'running';
    const activeStage = stages.find(stage => ['running','queued'].includes(stage.status)) || stages.find(stage => stage.status === 'unknown') || (workflowRunning?stages[workflowState.pendingStep]:null) || failed || interrupted || cancelled || (workflowState&&['awaiting_publish','stale'].includes(workflowState.status)?stages[workflowState.pendingStep]:null) || stages.find(stage => !stage.completed);
    const times = [draft.updatedAt,...runs.flatMap(run => [run.createdAt,run.endedAt]),exported?.createdAt].filter(Boolean).sort((a,b) => dateValue(b)-dateValue(a));
    return {
      id:draft.id, title:draft.title, mode:workflow?.mode||draft.mode||'manual', modeLabel:{manual:'手动',auto:'自动',background:'后台'}[workflow?.mode||draft.mode||'manual'], status, statusLabel:!active&&!unknown&&!failed&&!interrupted&&!cancelled&&workflow?.status==='awaiting_publish'?workflowState.label:labels[status],workflow:workflowState,
      progress:Math.round(completedStages/stages.length*100), completedStages, totalStages:stages.length,
      currentStep:activeStage?.index ?? 6, currentStepName:activeStage?.name || '视频发布', viewedStep:draft.step,
      createdAt:draft.createdAt, updatedAt:times[0] || draft.createdAt, stages,
      activeRun:publicRun(active), unknownRuns:runs.filter(run => run.status === 'unknown').map(publicRun),
      deletable:!workflowRunning&&workflow?.status!=='unknown'&&!runs.some(run => ['running','queued','unknown'].includes(run.status)),
      exportStatus:exported ? 'exported' : '',
    };
  });
}

module.exports = {summarizeTasks};
