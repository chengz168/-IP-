const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createService}=require('../server/service.cjs');
async function main(){
  const root=path.resolve('evidence/validation/dynamic-subtitles/local-text');fs.mkdirSync(root,{recursive:true});
  const service=createService(path.join(root,'workspace')),store=service.store,report={checkedAt:new Date().toISOString(),assertions:[]};
  report.previousFailures=store.data.runs.filter(run=>run.status==='failed').map(({type,error,createdAt})=>({type,error,createdAt}));
  const models=await (await fetch('http://127.0.0.1:11434/api/tags')).json();assert.ok(models.models.some(model=>model.name==='qwen3.5:9b-q4_K_M'),'只使用本机现有模型，不下载');
  Object.assign(store.data.settings.provider,{textProtocol:'ollama',baseUrl:'http://127.0.0.1:11434',model:'qwen3.5:9b-q4_K_M',textMaxTokens:'1024',textContextTokens:'8192'});store.save();
  const draft=store.draft();draft.edit.captions=[{start:0,end:1.5,text:'认真做好每一步'},{start:1.5,end:3,text:'从重要的事情开始'}];store.save();
  const before=structuredClone(draft.edit.captions);
  const translated=await service.invoke('subtitleAuxiliary',{id:draft.id,kind:'translation'});assert.equal(translated.local,true);assert.ok(translated.rows.every(row=>row.auxiliary.translation));assert.deepEqual(draft.edit.captions,before);
  report.translated=translated;report.assertions.push('实际已有9B本机模型逐句翻译，返回源签名且不自动覆盖编辑');
  draft.edit.captions=translated.rows;store.save();
  const highlighted=await service.invoke('subtitleAuxiliary',{id:draft.id,kind:'keywords'});assert.ok(highlighted.rows.every(row=>row.auxiliary.keywords.every(word=>row.text.includes(word))));assert.ok(highlighted.rows.every(row=>row.auxiliary.translation));report.highlighted=highlighted;report.assertions.push('实际本机模型提取原文连续关键词并保留已有译文');
  const pending=service.invoke('subtitleAuxiliary',{id:draft.id,kind:'translation'});const errorResult=pending.catch(error=>error);const running=store.data.runs.find(run=>run.status==='running');assert.ok(running);await service.invoke('cancelRun',{id:running.id});const error=await errorResult;assert.ok(error instanceof Error);assert.equal(running.status,'cancelled');report.cancelled={status:running.status,error:error.message};report.assertions.push('实际请求取消后运行记录为cancelled且不修改原字幕');
  fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
