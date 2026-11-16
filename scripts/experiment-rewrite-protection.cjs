const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createService}=require('../server/service.cjs'),{createDraft}=require('../server/store.cjs'),fixtures=require('./copy-quality-fixtures.cjs');
// 只用已安装本地模型，在独立工作区验证关键句保留，不改当前任务与模型配置。
(async()=>{
 const root=path.resolve('evidence/validation/rewrite-protection/limited-markers'),workspace=path.join(root,'experiment-workspace'),original=path.resolve('evidence/validation/pip-desktop-workspace/studio.json');
 assert(!fs.existsSync(workspace),'不覆盖已有实验');fs.mkdirSync(workspace,{recursive:true});
 const baselineText=fs.readFileSync(original,'utf8'),baseline=JSON.parse(baselineText),provider=baseline.settings.provider,model=provider.model;
 assert.equal(provider.textProtocol,'ollama');const base=provider.baseUrl.replace(/\/v1\/?$/u,'');assert(['127.0.0.1','localhost'].includes(new URL(base).hostname));
 const response=await fetch(base+'/api/tags');assert(response.ok);const tags=await response.json(),installed=tags.models.find(item=>item.name===model);assert(installed);
 fs.writeFileSync(path.join(root,'original-baseline.json'),baselineText);fs.writeFileSync(path.join(root,'installed-models.json'),JSON.stringify(tags,null,2));
 const data=structuredClone(baseline);data.runs=[];data.workflowJobs=[];data.drafts=fixtures.rewrites.map(f=>Object.assign(createDraft(),{title:'关键句保留虚构验收-'+f.id,sourceText:f.text,wordLimit:String(f.text.length),template:'reference-copy-v840',qualityFixture:f.id}));data.currentId=data.drafts[0].id;data.settings.outputDir=path.join(workspace,'outputs');
 fs.writeFileSync(path.join(workspace,'studio.json'),JSON.stringify(data,null,2));const service=createService(workspace),{referencePrompts}=await import('../server/reference-prompts.mjs'),{protectedRewriteRequest,assembleProtectedRewrite}=await import('./experiments/rewrite-protection.mjs'),{assessRewrite}=await import('../server/copy-quality.mjs'),cases=[];
 for(const fixture of fixtures.rewrites){
  const draft=service.store.data.drafts.find(d=>d.qualityFixture===fixture.id),input={fields:{sourceText:fixture.text,wordLimit:fixture.text.length},template:referencePrompts[0],generation:{model}},request=protectedRewriteRequest(input);
  const item={id:fixture.id,source:fixture.text,required:fixture.required,model,modelDigest:installed.digest,fixturesAreSynthetic:true,checkedAt:new Date().toISOString(),wrapperSource:request.wrapperSource,plan:request.plan,qualityAccepted:false};
  assert.equal(crypto.createHash('sha256').update(request.system).digest('hex'),input.template.source.sha256);
  try{item.result=await service.runtime.run('rewrite-protection-experiment',draft.id,{input},async ctx=>{
   const raw=await service.providers.text(request.system,request.user,ctx,{model,schema:request.schema});
   try{const assembled=assembleProtectedRewrite(request.plan,JSON.parse(raw.text));return {...raw,...assembled,rawText:raw.text,wrapperSource:request.wrapperSource,quality:assessRewrite(fixture.text,assembled.text,fixture.text.length,input.template,assembled.assembly)};}catch(error){error.evidence={...raw,input,unitPlan:request.plan,wrapperSource:request.wrapperSource};throw error;}
  });}catch(error){item.error=error.message;item.failureOutput=service.store.data.runs.find(r=>r.draftId===draft.id)?.failureOutput;}
  cases.push(item);fs.writeFileSync(path.join(root,fixture.id+'.json'),JSON.stringify(item,null,2));assert.equal(fs.readFileSync(original,'utf8'),baselineText);
  console.log(JSON.stringify({id:fixture.id,text:item.result?.text,protected:item.plan.protectedUnits.map(u=>u.id),error:item.error,quality:item.result?.quality}));
 }
 fs.writeFileSync(path.join(root,'experiment-report.json'),JSON.stringify({checkedAt:new Date().toISOString(),cases,totalRealModelRequests:service.store.data.runs.length,originalWorkspaceExactBytesUnchanged:fs.readFileSync(original,'utf8')===baselineText,productionRoutingChanged:false,qualityAccepted:false,referenceParityAccepted:false},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
