const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createService}=require('../server/service.cjs'),{createDraft}=require('../server/store.cjs'),fixtures=require('./copy-quality-fixtures.cjs');
const root=path.resolve(process.env.STUDIO_VALIDATION_ROOT||'evidence/validation/rewrite-completeness'),original=path.resolve('evidence/validation/pip-desktop-workspace'),workspace=path.join(root,'model-workspace'),reportFile=path.join(root,'model-report.json');
assert(!fs.existsSync(reportFile),'不重复已完成的真实模型验证');fs.mkdirSync(root,{recursive:true});
const baseline=JSON.parse(fs.readFileSync(path.join(original,'studio.json'),'utf8')),baselineFile=path.join(root,'original-baseline.json');
if(fs.existsSync(baselineFile))assert.deepEqual(JSON.parse(fs.readFileSync(baselineFile,'utf8')),baseline);else fs.writeFileSync(baselineFile,JSON.stringify(baseline,null,2));
assert.equal(baseline.settings.provider.textProtocol,'ollama');assert(['127.0.0.1','localhost','[::1]'].includes(new URL(baseline.settings.provider.baseUrl).hostname));
if(!fs.existsSync(workspace)){
 const data=structuredClone(baseline);data.settings.provider.model=process.env.STUDIO_VALIDATION_MODEL||'qwen3.8:27b';data.settings.outputDir=path.join(workspace,'outputs');data.runs=[];data.drafts=[];delete data.workflowJobs;
 for(const item of fixtures.rewrites){const draft=createDraft();Object.assign(draft,{title:'句段完整性虚构验收-'+item.id,sourceText:item.text,wordLimit:String(item.text.length),template:'reference-copy-v840',qualityFixture:item.id,rewrite:'保留手工稿'});data.drafts.push(draft);}
 data.currentId=data.drafts[0].id;fs.mkdirSync(workspace);fs.writeFileSync(path.join(workspace,'studio.json'),JSON.stringify(data,null,2));
}
const service=createService(workspace),cases=[],requests=[],text=service.providers.text.bind(service.providers);
service.providers.text=async(...args)=>{try{const result=await text(...args);requests.push(result);return result;}catch(error){requests.push({error:error.message});throw error;}};
(async()=>{
 const tags=await(await fetch('http://127.0.0.1:11434/api/tags')).json();assert(tags.models.some(model=>model.name===service.store.data.settings.provider.model),'仅使用确认已安装的模型');fs.writeFileSync(path.join(root,'installed-models.json'),JSON.stringify(tags,null,2));
 for(const fixture of fixtures.rewrites){const file=path.join(root,fixture.id+'.json');if(fs.existsSync(file)){cases.push(JSON.parse(fs.readFileSync(file,'utf8')));continue;}
  const started=Date.now(),index=requests.length,draft=service.store.data.drafts.find(d=>d.qualityFixture===fixture.id);let result,error;
  try{result=await service.invoke('text',{id:draft.id,kind:'rewrite'});}catch(e){error=e.message;}
  const item={id:fixture.id,checkedAt:new Date().toISOString(),fixturesAreSynthetic:true,source:fixture.text,required:fixture.required,elapsedMs:Date.now()-started,result,error,requests:requests.slice(index),run:service.store.data.runs.find(run=>run.draftId===draft.id),qualityAccepted:false};fs.writeFileSync(file,JSON.stringify(item,null,2));cases.push(item);assert.equal(draft.rewrite,'保留手工稿');assert.deepEqual(JSON.parse(fs.readFileSync(path.join(original,'studio.json'),'utf8')),baseline);console.log(JSON.stringify({id:item.id,elapsedMs:item.elapsedMs,error,output:result?.text,quality:result?.quality}));
 }
 const sourceFiles=['server/rewrite-generation.mjs','server/rewrite-units.mjs','server/copy-quality.mjs','server/reference-prompts.mjs'];
 const report={checkedAt:new Date().toISOString(),model:service.store.data.settings.provider.model,workspace,sourceHashes:sourceFiles.map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')})),cases,originalUnchanged:true,automaticRetries:0,qualityAccepted:false};fs.writeFileSync(reportFile,JSON.stringify(report,null,2));console.log(JSON.stringify({reportFile,cases:cases.length,requests:cases.reduce((n,c)=>n+c.requests.length,0),qualityAccepted:false}));
})().catch(error=>{console.error(error);process.exitCode=1;});
