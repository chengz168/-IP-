const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createService}=require('../server/service.cjs');

// 在独立目录请求本机已有模型，记录真实输出，不替换用户任务。
async function main(){
  const service=createService(path.resolve('evidence/validation/marketing-workspace'));
  const model='qwen3.5:9b-q4_K_M';
  await service.invoke('saveSettings',{outputDir:'',provider:{baseUrl:'http://127.0.0.1:11434/v1',model,textProtocol:'ollama',textMaxTokens:'1024',textContextTokens:'8192'}});
  const draft=service.store.draft();
  draft.marketing={name:'',audience:'办公桌使用者',selling:'抽屉分层放置文具和小物件；选购前需测量桌面空间，不能承诺适合所有桌型。',persona:'分享个人整理经验',offer:''};
  draft.wordLimit='137';
  draft.title='仅卖点营销真实验证';
  service.store.save();
  const rows=[];
  for(const wordLimit of ['', '0', '-1', '1.5', '随意填写']){
    draft.wordLimit=wordLimit;
    const count=service.store.data.runs.length;
    await assert.rejects(service.invoke('text',{id:draft.id,kind:'marketing'}),/正整数/);
    assert.equal(service.store.data.runs.length,count);
    rows.push({wordLimit,rejectedBeforeRun:true});
  }
  draft.wordLimit='137';
  const selling=draft.marketing.selling;
  draft.marketing.selling='  ';
  const count=service.store.data.runs.length;
  await assert.rejects(service.invoke('text',{id:draft.id,kind:'marketing'}),/至少输入产品名称或卖点/);
  assert.equal(service.store.data.runs.length,count);
  draft.marketing.selling=selling;
  service.store.save();
  const started=Date.now();
  const result=await service.invoke('text',{id:draft.id,kind:'marketing'});
  assert.ok(result.text.trim());
  const run=service.store.data.runs[0];
  assert.equal(run.status,'succeeded');
  assert.equal(run.snapshot.marketing.name,'');
  assert.equal(run.snapshot.wordLimit,'137');
  const report={contextTokens:8192,previousFailures:service.store.data.runs.filter(r=>r.status==='failed').map(r=>({id:r.id,error:r.error})),checkedAt:new Date().toISOString(),status:'passed',model,elapsedMs:Date.now()-started,invalidWordLimits:rows,emptyMarketingRejectedBeforeRun:true,input:draft.marketing,requestedWords:137,result,run,scope:'仅验证营销二选一校验、自定义字数传递及本机真实生成；输出不保证精确137字，未认定原厂候选数量或内容质量一致'};
  const file=path.resolve('evidence/validation/marketing-report.json');
  fs.writeFileSync(file,JSON.stringify(report,null,2));
  console.log(JSON.stringify({file,status:report.status,elapsedMs:report.elapsedMs,text:result.text,usage:result.usage},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
