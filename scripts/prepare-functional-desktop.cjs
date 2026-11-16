const fs=require('node:fs');
const path=require('node:path');
const {createService}=require('../server/service.cjs');

// 桌面验收仅使用隔离数据和现有素材，不覆盖源码默认任务或原软件数据。
async function main(){
  const root=path.resolve('evidence/validation/functional-desktop-workspace');
  if(fs.existsSync(path.join(root,'studio.json')))throw new Error('验收目录已有状态，请检查现有结果，不重复初始化');
  const service=createService(root);
  const settings=JSON.parse(fs.readFileSync('data/studio.json','utf8')).settings;
  await service.invoke('saveSettings',{outputDir:'',ffmpegPath:settings.ffmpegPath,ffprobePath:settings.ffprobePath,provider:{baseUrl:'http://127.0.0.1:11434/v1',model:'qwen3.5:9b-q4_K_M',textProtocol:'ollama',textMaxTokens:'1024'}});
  const source=service.store.addAsset(path.resolve('evidence/reference-media/original-edit-test.mp4'));
  const cover=service.store.addAsset(path.resolve('evidence/reference-media/original-cover-layer-test.jpg'));
  const silence=service.store.addAsset(path.resolve('evidence/validation/silence-workspace/真实素材与人工静音.mp4'));
  const draft=service.store.draft();
  draft.title='桌面功能验收 · 首帧与营销';draft.tab='marketing';
  draft.edit.sourceId=source.id;
  draft.cover.backgroundId=cover.id;draft.cover.title='首帧功能验收';
  draft.cover.mask=0;draft.cover.subtitle='正文从第二帧开始';
  const silenceDraft=await service.invoke('newDraft');
  silenceDraft.title='桌面功能验收 · 剪气口';silenceDraft.step=4;
  silenceDraft.edit.sourceId=silence.id;silenceDraft.edit.cutSilence=true;
  silenceDraft.edit.silenceThreshold=-42;silenceDraft.edit.silenceMinimum=.4;silenceDraft.edit.silencePadding=.08;
  silenceDraft.edit.captions=[{start:1,end:2.7,text:'第一段真实声音文字'},{start:5,end:6.7,text:'第二段真实声音文字'}];
  service.store.data.currentId=draft.id;service.store.save();
  const manifest={root,draftId:draft.id,silenceDraftId:silenceDraft.id,sourceId:source.id,backgroundId:cover.id,silenceId:silence.id};
  fs.writeFileSync('evidence/validation/functional-desktop-manifest.json',JSON.stringify(manifest,null,2));
  console.log(JSON.stringify(manifest));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
