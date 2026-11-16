const fs=require('node:fs');
const path=require('node:path');
module.exports=async function(page){
  const errors=[];const onError=e=>errors.push(e.message);page.on('pageerror',onError);
  async function menu(name){await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('navigation',{name:'主菜单'}).getByRole('button',{name,exact:true}).click();}
  async function waitDraft(predicate){const deadline=Date.now()+15000;while(Date.now()<deadline){const s=await page.evaluate(()=>window.studio.invoke('state')),d=s.drafts.find(d=>d.id===s.currentId);if(predicate(d))return d;await page.waitForTimeout(100);}throw new Error('等待任务自动保存超时');}
  await menu('新工作流');await page.locator('.steps>button').nth(3).click();
  if(await page.locator('.video-shot').count()){while(await page.locator('.video-shot').count())await page.locator('.video-shot').first().getByRole('button').click();}
  await page.getByRole('button',{name:'选取音频',exact:true}).click();
  await page.getByRole('dialog').getByRole('button').filter({hasText:'画中画验收主视频.mp4'}).click();
  await page.getByRole('button',{name:'多镜头',exact:true}).click();
  await page.getByRole('button',{name:'添加镜头',exact:true}).click();
  await page.getByLabel('镜头1时长',{exact:true}).fill('2.5');
  await waitDraft(d=>d.video.shots[0]?.duration===2.5&&d.video.audioId);
  await page.reload();await page.locator('.steps>button').nth(3).click();
  if(await page.getByLabel('镜头1时长',{exact:true}).inputValue()!=='2.5')throw new Error('多镜头参数刷新后未恢复');
  const before=await page.evaluate(()=>window.studio.invoke('state'));const main=before.assets.find(a=>a.name==='画中画验收主视频.mp4');
  const draft=before.drafts.find(d=>d.id===before.currentId);if(draft.video.audioId!==main.id)throw new Error('驱动音频选择没有保存');
  await page.getByRole('button',{name:'删除镜头1',exact:true}).click();await page.getByRole('button',{name:'单形象',exact:true}).click();
  await page.locator('.steps>button').nth(6).click();
  await page.getByRole('button',{name:'选择视频',exact:true}).click();
  await page.getByRole('dialog').getByRole('button').filter({hasText:'画中画验收主视频.mp4'}).click();
  await page.getByLabel('作品标题',{exact:true}).fill('发布表单布局验证');
  await page.getByLabel('作品描述',{exact:true}).fill('本地商品视频，仅验证导出。');
  await page.getByLabel('话题标签',{exact:true}).fill('收纳 本地验收');
  await page.getByRole('button',{name:'选择封面',exact:true}).click();await page.getByRole('dialog').getByRole('button').filter({hasText:'红色图片.png'}).click();
  await page.getByRole('button',{name:'直接发布',exact:true}).click();await page.getByRole('button',{name:'草稿',exact:true}).click();
  await page.getByRole('button',{name:'导出发布包',exact:true}).click();
  await page.getByRole('dialog',{name:'发布包已导出'}).waitFor();
  const after=await page.evaluate(()=>window.studio.invoke('state')),saved=after.drafts.find(d=>d.id===after.currentId),record=after.publishRecords.find(r=>r.id===saved.publish.recordId);
  if(!record||saved.publish.title!=='发布表单布局验证'||saved.publish.tags.length!==2||saved.publish.mode!=='draft')throw new Error('发布表单或实际导出记录不正确');
  const metadata=JSON.parse(fs.readFileSync(path.join(record.directory,'发布信息.json'),'utf8'));if(metadata.title!==saved.publish.title||metadata.status!=='exported')throw new Error('发布包元数据不正确');
  if(!fs.statSync(path.join(record.directory,'video.mp4')).size||!fs.statSync(path.join(record.directory,'cover.png')).size)throw new Error('发布包缺少真实媒体');
  await page.getByRole('button',{name:'知道了',exact:true}).click();await page.reload();
  if(await page.getByLabel('作品标题',{exact:true}).inputValue()!=='发布表单布局验证')throw new Error('发布文案刷新后丢失');
  await page.getByRole('button',{name:'立即发布',exact:true}).click();await page.getByRole('dialog',{name:'平台发布尚未接入'}).waitFor();await page.getByRole('button',{name:'知道了',exact:true}).click();
  await menu('旧工作流');await page.locator('.legacy-render .check-row').filter({hasText:'启用画中画'}).getByRole('button',{name:'选择',exact:true}).click();await page.getByRole('dialog').getByRole('button').filter({hasText:'蓝色图片.png'}).click();
  await waitDraft(d=>d.edit.pipMode==='continuous'&&d.edit.pipId);
  const final=await page.evaluate(()=>window.studio.invoke('state')),last=final.drafts.find(d=>d.id===final.currentId);if(final.assets.find(a=>a.id===last.edit.pipId)?.name!=='蓝色图片.png')throw new Error('旧工作流未正确选择图片或切换全程模式');
  page.off('pageerror',onError);
  const report={checkedAt:new Date().toISOString(),runtime:'Electron',driverAudioSaved:true,multiShotDurationRestored:2.5,publishFieldsRestored:true,exportDirectory:record.directory,exportedFiles:fs.readdirSync(record.directory),metadata,platformNotConnected:true,legacyImageSelected:true,legacyPipMode:last.edit.pipMode,pageErrors:errors};
  fs.writeFileSync(path.resolve('evidence/validation/panel-bindings-report.json'),JSON.stringify(report,null,2));if(errors.length)throw new Error(errors.join('\n'));return report;
};
