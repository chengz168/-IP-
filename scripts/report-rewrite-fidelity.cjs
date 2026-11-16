const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');

// 汇总已有真实请求及逐句审读意见，不再次调用模型，也不修改用户配置。
(async()=>{
 const root=path.resolve('evidence/validation/rewrite-fidelity'),read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
 const experiments=[
  {file:'9b-report.json',expectedRequests:4,review:'初稿多沿用原句；步骤校订重复固定开头，产品和通知的数字中文写法违反现有原写法规约。数字中文化本身不等于事实错误。'},
  {file:'27b-report.json',expectedRequests:6,review:'步骤和产品校订稿与初稿逐字相同，未补回自己的话、可用电源等细节；通知补回动作位置，但后半大段恢复原句。'},
  {file:'clauses/report.json',expectedRequests:3,review:'步骤保留自己的话等细节；产品的核对使用习惯变成掂量用不用得上；通知将带书上限改成手持数量，限定动作变化。'},
  {file:'clauses-v2-9b/report.json',expectedRequests:3,review:'步骤仍大量沿用原句，别急着直接删掉弱化为暂缓语气；产品可用电源缩成有没有电源，买前得核对习惯生硬。产品12和通知5中文化被原写法规约拒绝，不据此声称数值错误。'},
  {file:'clauses-v2-27b/report.json',expectedRequests:3,review:'步骤恢复自己的语言等细节，但仍需审读试着等语气变化；产品保留可用电源，末句仍改变核对对象；通知每人最多带5本书变成每个人手里最多只能拿5本，限定动作仍变化。追加自然普通话及限定修饰要求未解决该例。'}
 ];
 const runIds=new Set();
 for(const experiment of experiments){
  const report=read(path.join(root,experiment.file)),runs=experiment.file.includes('/')?read(path.join(root,path.dirname(experiment.file),'workspace/studio.json')).runs:report.cases.flatMap(c=>c.runs);
  assert.equal(runs.length,experiment.expectedRequests);for(const run of runs){assert(!runIds.has(run.id));runIds.add(run.id);}
  experiment.actualRequests=runs.length;experiment.cases=report.cases.map(c=>({id:c.id,source:c.source,output:c.joined||c.edited?.text||c.baseline?.text||'',error:c.assemblyError||c.error||'',qualityAccepted:false}));
 }
 const {referencePrompts}=await import('../server/reference-prompts.mjs');
 const templates=referencePrompts.map(t=>{
  const source=fs.readFileSync(t.source.evidence,'utf8').replace(/\r\n/g,'\n'),sha256=crypto.createHash('sha256').update(source).digest('hex');assert.equal(t.content,source);assert.equal(sha256,t.source.sha256);
  return{id:t.id,characters:source.length,sha256,exactSourceMatch:true,completeCloudRequest:false};
 });
 const live=read('evidence/validation/pip-desktop-workspace/studio.json');assert.deepEqual(live,read('evidence/validation/caption-source/original-baseline.json'));
 const draft=live.drafts.find(d=>d.id===live.currentId),provider=live.settings.provider;
 const result={checkedAt:new Date().toISOString(),scope:'已有隔离实验真实回包的逐句文本审读及当前配置只读核对；未新增调用或音画验收',fixturesAreSynthetic:true,totalRealModelRequests:runIds.size,experiments,reviewMethod:'人工逐句比较源文与实际回包，意见只适用于所列样本；未做统计泛化或原厂同输入对照',decision:'实验尚未稳定保留限定条件和自然表达，不接入生产；不自动更换模型或模板，不追加无效二次校订',productionChanged:false,templates,currentConfiguration:{taskId:draft.id,template:draft.template,model:provider.model,ttsProtocol:provider.ttsProtocol,ttsModelConfigured:!!provider.ttsModel,cloneServiceConfigured:!!provider.cloneUrl,avatarServiceConfigured:!!provider.avatarUrl},originalWorkspaceCompleteJsonUnchanged:true,includesUpdatedAt:true,referenceVoiceInternalPromptObtained:false,referenceAvatarInternalPromptObtained:false,qualityAccepted:false,referenceParityAccepted:false,audioAudited:false};
 fs.writeFileSync(path.join(root,'quality-review.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({checkedAt:result.checkedAt,totalRealModelRequests:result.totalRealModelRequests,experiments:experiments.map(({file,actualRequests})=>({file,actualRequests})),templates,originalWorkspaceCompleteJsonUnchanged:true,productionChanged:false,qualityAccepted:false,referenceParityAccepted:false}));
})().catch(error=>{console.error(error);process.exitCode=1;});
