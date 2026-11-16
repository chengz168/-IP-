const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createService}=require('../server/service.cjs');
async function main(){
  const root=path.resolve('evidence/validation/dynamic-subtitles'),workspace=path.join(root,'desktop-workspace');
  assert.ok(!fs.existsSync(path.join(workspace,'studio.json')),'不能覆盖已有验收工作区');
  const original=fs.readFileSync('evidence/validation/pip-desktop-workspace/studio.json','utf8');fs.writeFileSync(path.join(root,'original-desktop-baseline.json'),original);
  fs.mkdirSync(workspace,{recursive:true});fs.writeFileSync(path.join(workspace,'studio.json'),original);
  const service=createService(workspace),store=service.store;
  Object.assign(store.data.settings,{subtitleFontsDir:'F:/Software/轻语IP智能体/aigc-human/resources/fonts'});
  Object.assign(store.data.settings.provider,{textProtocol:'ollama',baseUrl:'http://127.0.0.1:11434',model:'qwen3.5:9b-q4_K_M',textMaxTokens:'1024',textContextTokens:'8192'});
  const base=store.draft(),draft=await service.invoke('newDraft');draft.title='动态字幕独立桌面验收';draft.step=4;draft.edit.sourceId=base.edit.sourceId||base.video.assetId;
  assert.ok(draft.edit.sourceId,'需要已有本地视频源');
  draft.edit.captions=[{start:0,end:1.5,text:'认真做好每一步',auxiliary:{sourceText:'认真做好每一步',translation:'Make every step count.',keywords:['认真']}},{start:1.5,end:3,text:'从重要的事情开始',auxiliary:{sourceText:'从重要的事情开始',translation:'Start with what matters.',keywords:['重要']}}];store.save();
  fs.writeFileSync(path.join(root,'desktop-fixture.json'),JSON.stringify({workspace,id:draft.id,originalId:base.id},null,2));console.log(JSON.stringify({workspace,id:draft.id,sourceId:draft.edit.sourceId}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
