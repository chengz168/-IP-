const fs=require('node:fs');
const path=require('node:path');
const {createService}=require('../server/service.cjs');

// 在独立数据目录验证已有本地模型，不修改用户工作台设置或下载模型。
async function main(){
  const root=path.resolve('evidence/validation/local-text-workspace');
  const service=createService(root);
  const model='qwen3.5:9b-q4_K_M';
  await service.invoke('saveSettings',{outputDir:'',provider:{baseUrl:'http://127.0.0.1:11434/v1',model,textProtocol:'ollama',textMaxTokens:'1024'}});
  const connection=await service.invoke('testConnection');
  if(!connection.models.includes(model))throw new Error('本地服务未返回所选模型');
  const draft=service.store.draft();
  draft.title='本地模型真实改写验证';
  draft.sourceText='桌面收纳盒可以分类放置文具和小物件。选购时先测量桌面空间，再检查分隔结构是否适合自己的物品。不要只看外观，也不要购买尺寸不合适的款式。';
  draft.wordLimit='100';
  service.store.save();
  const started=Date.now();
  const result=await service.invoke('text',{id:draft.id,kind:'rewrite'});
  const report={checkedAt:new Date().toISOString(),endpoint:'http://127.0.0.1:11434/v1',model,elapsedMs:Date.now()-started,input:draft.sourceText,result,run:service.store.data.runs[0],scope:'仅验证真实文本推理和运行记录；未验证原厂效果一致性、TTS或数字人'};
  const file=path.resolve('evidence/validation/local-text-report.json');
  fs.writeFileSync(file,JSON.stringify(report,null,2));
  console.log(JSON.stringify({file,model,elapsedMs:report.elapsedMs,status:report.run.status,text:result.text,usage:result.usage},null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
