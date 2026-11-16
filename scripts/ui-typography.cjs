const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve('evidence/validation/typography');
const stateFile=path.resolve('evidence/validation/pip-desktop-workspace/studio.json');
const labels={compact:'紧凑',standard:'标准',comfortable:'舒适',large:'大'};
const read=()=>JSON.parse(fs.readFileSync(stateFile,'utf8'));
const recordFile=path.join(root,'desktop-report.json');
const save=report=>fs.writeFileSync(recordFile,JSON.stringify(report,null,2));
async function menu(page,name){await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('navigation',{name:'主菜单'}).getByRole('button',{name,exact:true}).click();}
async function general(page){await menu(page,'设置');await page.locator('.settings-nav').getByRole('button',{name:'常规设置',exact:true}).click();}
async function choose(page,id){await general(page);await page.getByRole('group',{name:'界面字号',exact:true}).getByRole('button',{name:labels[id],exact:true}).click();await page.waitForFunction(id=>document.documentElement.dataset.fontSize===id,id);await page.waitForFunction(()=>!document.querySelector('.operation-status'));assert.equal(read().settings.fontSize,id);}
module.exports={choose,async verify(page){
  fs.mkdirSync(root,{recursive:true});
  const initial=read(),report={checkedAt:new Date().toISOString(),originalId:initial.currentId,initial,assertions:[],pageErrors:[]};save(report);
  const onError=e=>report.pageErrors.push(e.message);page.on('pageerror',onError);
  try{
    await general(page);await page.getByRole('textbox',{name:'统一输出根目录 选择',exact:true}).fill('D:\\未提交字号测试');
    await page.locator('.settings-nav').getByRole('button',{name:'模型设置',exact:true}).click();
    await page.getByLabel('兼容服务 Base URL',{exact:true}).fill('http://127.0.0.1:9/unsaved');await page.getByLabel('API Key',{exact:true}).fill('未提交的测试文本');await page.getByRole('checkbox',{name:'更新密钥',exact:true}).check();
    // 留在同一设置组件内切换导航，验证即时字号保存不带走未提交配置。
    await page.locator('.settings-nav').getByRole('button',{name:'常规设置',exact:true}).click();
    for(const id of Object.keys(labels)){
      await page.getByRole('group',{name:'界面字号',exact:true}).getByRole('button',{name:labels[id],exact:true}).click();
      await page.waitForFunction(id=>document.documentElement.dataset.fontSize===id,id);await page.waitForFunction(()=>!document.querySelector('.operation-status'));
      const current=read(),expected=structuredClone(initial);expected.settings.fontSize=id;assert.deepEqual(current,expected);
      await page.screenshot({path:path.join(root,'settings-'+id+'.png')});
      report.assertions.push({name:'即时切换及只写字号',id,geometry:await page.locator('.settings-layout').evaluate(e=>[...e.querySelectorAll('.settings-nav>header,.settings-heading,.settings-choice')].map(x=>({selector:x.className||x.tagName,height:x.getBoundingClientRect().height,width:x.getBoundingClientRect().width})))});save(report);
    }
    await page.reload();await general(page);assert.equal(await page.getByRole('button',{name:'大',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(read().settings.fontSize,'large');report.assertions.push({name:'刷新后恢复大字号'});
    await page.getByRole('button',{name:'本地用户',exact:false}).click();
    const dialog=page.getByRole('dialog',{name:'本地用户',exact:true});await dialog.waitFor();const font=await dialog.locator('.modal-body').evaluate(e=>getComputedStyle(e).fontSize);assert.equal(font,'18px');await page.keyboard.press('Escape');report.assertions.push({name:'传送弹窗继承根字体',font});
    await choose(page,initial.settings.fontSize);
    // 为全页检查建立独立副本，页面切换的自动保存不会改原任务。
    await menu(page,'任务中心');await page.getByRole('button',{name:'新建任务',exact:true}).click();report.temporaryId=read().currentId;
    const original=initial.drafts.find(d=>d.id===initial.currentId),fresh=read().drafts.find(d=>d.id===report.temporaryId);
    const fixture={...structuredClone(original),id:fresh.id,createdAt:fresh.createdAt,updatedAt:fresh.updatedAt,title:'四档字号布局验收副本'};
    await page.evaluate(fixture=>window.studio.invoke('saveDraft',fixture),fixture);await page.reload();report.assertions.push({name:'全页检查使用独立任务副本',id:fresh.id});report.phase='ready-for-layout';save(report);return {assertions:report.assertions,pageErrors:report.pageErrors,temporaryId:fresh.id};
  }catch(error){report.error=error.stack;save(report);throw error;}finally{page.off('pageerror',onError);}
},async cleanup(page){
  const report=JSON.parse(fs.readFileSync(recordFile,'utf8'));await choose(page,report.initial.settings.fontSize);await menu(page,'任务中心');
  const row=page.locator('.draft-task-table tbody tr').filter({hasText:'四档字号布局验收副本'});await row.getByRole('button',{name:'删除',exact:true}).click();
  const dialog=page.getByRole('dialog');if(await dialog.count())await dialog.getByRole('button',{name:/确定|删除/}).last().click();
  await page.waitForFunction(id=>window.studio.invoke('state').then(s=>!s.drafts.some(d=>d.id===id)),report.temporaryId);
  if(read().currentId!==report.originalId)await page.locator('.draft-task-table tbody tr').filter({hasText:report.initial.drafts.find(d=>d.id===report.originalId).title}).getByRole('button',{name:'继续',exact:true}).click();
  assert.deepEqual(read().drafts.find(d=>d.id===report.originalId),report.initial.drafts.find(d=>d.id===report.originalId));report.originalDraftUnchanged=true;report.phase='completed-listed-checks';save(report);return {originalDraftUnchanged:true,temporaryDeleted:!read().drafts.some(d=>d.id===report.temporaryId)};
}};
