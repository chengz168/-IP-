const crypto=require('node:crypto');
const {resolveCreativePreset}=require('./creative-presets.mjs');
const {learningState,learningStages,learningRunStages,learningScope,selectLearning,sameLearningScope}=require('./creative-learning.mjs');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const requiredRule=value=>{if(typeof value!=='string'||value.trim().length<4||value.trim().length>300)throw Error('请填写4至300字的可复用表达或镜头偏好，不填写商品参数和具体事实');return value.trim();};
function routeForRun(run){
 const stage=learningRunStages[run.type];if(!stage||!run.snapshot)return null;
 const frozen=run.output?.creativePreset||run.parameters?.creativePreset||run.parameters?.input?.creativePreset;
 if(frozen&&frozen.stage===stage)return frozen;
 const kind=run.type==='product-script'||run.type==='product-shot-design'?'product':run.type==='reference-script'?'reference':run.type.includes('marketing')?'marketing':run.type.includes('topic')?'topic':undefined;
 return resolveCreativePreset(run.snapshot,stage,{...(kind?{kind}:{}),...(run.type==='rewrite'?{kind:'rewrite',content:run.snapshot.sourceText}:{} )});
}
function runScope(run){return learningScope(routeForRun(run),learningRunStages[run.type]);}
function freezeLearning(data,run){return selectLearning(data,runScope(run));}
const excerpt=run=>String(run.output?.text||run.output?.rawText||JSON.stringify(run.output?.design||run.output?.candidates||run.output?.topics||run.output?.story?.episodes||'')).slice(0,500);
function feedbackSource(run){
 if(run.status!=='succeeded'||run.output?.stale||run.output?.modelExecuted===false||run.output?.quality?.status==='rejected'||!run.output||!learningRunStages[run.type])throw Error('仅支持对未过期、未被检查拒绝的创作模型结果反馈；运行成功仍需你判断质量');
 const scope=runScope(run);if(!scope)throw Error('此结果没有可匹配的创作类型，或当时关闭了创作预设');
 return {scope,source:{runId:run.id,draftId:run.draftId,type:run.type,createdAt:run.createdAt,outputSha256:hash(run.output),excerpt:excerpt(run)}};
}
class CreativeFeedback{
 constructor(store){this.store=store;}
 state({id,stage}={}){
  const current=learningState(this.store.data),draft=id?this.store.draft(id):null;
  const route=draft&&learningStages[stage]?resolveCreativePreset(draft,stage,stage==='rewrite'?{kind:'rewrite',content:draft.sourceText}:{}):null;
  const runs=this.store.data.runs.filter(run=>!id||run.draftId===id).flatMap(run=>{try{const value=feedbackSource(run);return stage&&value.scope.stage!==stage?[]:[{id:run.id,title:run.snapshot?.title||'创作任务',createdAt:run.createdAt,...value,used:run.creativeLearning?.applications||[],appliedEntries:run.creativeLearning?.snapshot?.entries||[]}];}catch{return [];}}).slice(0,30);
  const history=this.store.data.runs.filter(run=>(!id||run.draftId===id)&&run.creativeLearning?.applications?.length&&(!stage||run.creativeLearning.snapshot.scope?.stage===stage)).slice(0,30).map(run=>({id:run.id,title:run.snapshot?.title||'创作任务',createdAt:run.createdAt,status:run.status,scope:structuredClone(run.creativeLearning.snapshot.scope),used:structuredClone(run.creativeLearning.applications),appliedEntries:structuredClone(run.creativeLearning.snapshot.entries)}));
  return { ...structuredClone(current),preview:selectLearning(this.store.data,learningScope(route,stage)),runs,history,stages:learningStages};
 }
 commit(revision,change){
  const previous=this.store.data.creativeLearning,current=learningState(this.store.data);
  if(!Number.isInteger(revision)||revision!==current.revision)throw Error('创作经验已变化，请刷新后重试，当前输入保留');
  const next=structuredClone(current);change(next);next.revision++;next.updatedAt=new Date().toISOString();this.store.data.creativeLearning=next;
  try{this.store.save();}catch(error){if(previous===undefined)delete this.store.data.creativeLearning;else this.store.data.creativeLearning=previous;throw error;}
  return structuredClone(next);
 }
 add({runId,rule,rating,revision}){
  const run=this.store.data.runs.find(r=>r.id===runId);if(!run)throw Error('反馈来源记录不存在');
  const source=feedbackSource(run),value=requiredRule(rule);if(!['keep','improve'].includes(rating))throw Error('请选择保留优点或纠正问题');
  return this.commit(revision,next=>{
   if(next.entries.length>=100)throw Error('创作经验最多保存100条，请清理不再适用的经验');
   if(next.entries.some(e=>sameLearningScope(e.scope,source.scope)&&e.rule===value))throw Error('同类型和阶段已有相同经验，请直接管理原记录');
   const now=new Date().toISOString();next.entries.push({id:crypto.randomUUID(),revision:1,enabled:true,rule:value,rating,...source,createdAt:now,updatedAt:now,history:[]});
  });
 }
 update({revision,entryId,entryRevision,enabled,rule}){
  if(typeof enabled!=='boolean'&&rule===undefined)throw Error('请指定启用状态或修改后的经验');
  if(enabled!==undefined&&typeof enabled!=='boolean')throw Error('启用状态必须为布尔值');
  const value=rule===undefined?undefined:requiredRule(rule);
  if(!entryId&&value!==undefined)throw Error('修改经验需指定记录');
  return this.commit(revision,next=>{
   if(!entryId){next.enabled=enabled;return;}
   const entry=next.entries.find(e=>e.id===entryId);if(!entry||entry.revision!==entryRevision)throw Error('这条经验已变化，请刷新后重试');
   if(value!==undefined&&next.entries.some(e=>e.id!==entryId&&sameLearningScope(e.scope,entry.scope)&&e.rule===value))throw Error('同类型和阶段已有相同经验');
   entry.history=[...entry.history,{revision:entry.revision,rule:entry.rule,enabled:entry.enabled,updatedAt:entry.updatedAt}].slice(-10);
   if(value!==undefined)entry.rule=value;if(enabled!==undefined)entry.enabled=enabled;entry.revision++;entry.updatedAt=new Date().toISOString();
  });
 }
 remove({revision,entryId,entryRevision}){return this.commit(revision,next=>{const entry=next.entries.find(e=>e.id===entryId);if(!entry||entry.revision!==entryRevision)throw Error('这条经验已变化，请刷新后重试');next.entries=next.entries.filter(e=>e.id!==entryId);});}
}
module.exports={CreativeFeedback,freezeLearning,feedbackSource,runScope};
