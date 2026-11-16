const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');

// 临时任务使用现有真实视频，所有业务动作通过桌面控件完成。
module.exports=async function verifyTaskCenter(page,options={}){
  const directory=path.resolve('evidence/validation/task-center');fs.mkdirSync(directory,{recursive:true});
  const stateFile=path.resolve('evidence/validation/pip-desktop-workspace/studio.json');
  const read=()=>JSON.parse(fs.readFileSync(stateFile,'utf8'));
  const checkpointFile=path.join(directory,'checkpoint.json');
  const checkpoint=options.resume?JSON.parse(fs.readFileSync(checkpointFile,'utf8')):null;
  const initial=checkpoint?.initial||read(),original=initial.drafts.find(item=>item.id===initial.currentId),createdIds=checkpoint?.createdIds||[];
  const report={checkedAt:new Date().toISOString(),assertions:[],pageErrors:[],temporaryDraftIds:createdIds,originalId:original.id};
  const errorListener=error=>report.pageErrors.push(error.message);page.on('pageerror',errorListener);
  const state=()=>page.evaluate(()=>window.studio.invoke('state'));
  async function until(check,label,timeout=15000){const start=Date.now();while(Date.now()-start<timeout){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('等待实际结果超时：'+label);}
  async function menu(name){await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('navigation',{name:'主菜单'}).getByRole('button',{name,exact:true}).click();}
  const row=id=>page.locator('.draft-task-table tbody>tr[data-task-id="'+id+'"]');
  const dialog=page.getByRole('dialog',{name:'任务详情',exact:true});
  async function title(value){await page.getByRole('textbox',{name:'任务名称',exact:true}).fill(value);await until(()=>read().drafts.find(item=>item.id===read().currentId).title===value,'标题保存');}
  const summary=async id=>(await state()).taskSummaries.find(task=>task.id===id);
  async function capture(name){await page.mouse.move(700,30);await page.screenshot({path:path.join(directory,name+'.png')});}
  try{
    if(!options.resume){
    assert.equal(initial.drafts.length,1,'此专项使用现有单任务隔离工作区');
    await menu('任务中心');
    const originalSummary=await summary(original.id);
    const stats=await page.locator('.stat-grid article>strong').allTextContents();
    assert.equal(stats[0],'1');assert.equal(stats[2],'0');
    assert.equal(originalSummary.stages[3].available,true);assert.notEqual(originalSummary.status,'succeeded');
    await row(original.id).getByRole('button',{name:'详情',exact:true}).click();
    assert.equal(await dialog.locator('.task-stage-list>li').count(),7);
    await dialog.locator('[data-stage="video"]').getByText('当前为手动导入剪辑源，不代表已生成数字人。',{exact:true}).waitFor();
    await capture('detail-original-1400-top');
    await dialog.locator('.modal-body').evaluate(element=>element.scrollTop=element.scrollHeight);
    await dialog.locator('[data-stage="publish"]').getByText('尚未取得平台发布确认。',{exact:true}).waitFor();
    await capture('detail-original-1400-bottom');
    await dialog.getByRole('button',{name:'删除任务',exact:true}).click();
    await page.getByRole('dialog',{name:'删除创作任务',exact:true}).getByRole('button',{name:'取消',exact:true}).click();
    await dialog.waitFor();await page.keyboard.press('Escape');
    report.assertions.push({name:'当前任务统计、七阶段详情与取消删除',summary:originalSummary,stats});

    const emptyIds=[];
    for(let index=0;index<10;index++){
      await page.getByRole('button',{name:'新建任务',exact:true}).click();
      await page.locator('.steps>button').first().waitFor();
      const id=read().currentId;assert(!initial.drafts.some(item=>item.id===id));createdIds.push(id);emptyIds.push(id);
      fs.writeFileSync(checkpointFile,JSON.stringify({initial,createdIds},null,2));
      await menu('任务中心');
    }
    assert.equal(await page.locator('.draft-task-table tbody>tr').count(),10);
    await page.getByRole('button',{name:'下一页',exact:true}).click();assert.equal(await page.locator('.draft-task-table tbody>tr').count(),1);
    await page.getByRole('combobox',{name:'每页条数',exact:true}).selectOption('20');assert.equal(await page.locator('.draft-task-table tbody>tr').count(),11);assert.equal(await page.locator('.page-number').innerText(),'1');
    await capture('pagination-11-tasks');
    const filter=page.getByRole('combobox',{name:'筛选任务状态',exact:true});
    await filter.selectOption('pending');
    assert.equal(await page.locator('.draft-task-table tbody>tr').count(),11,'筛选按钮提交前保留当前列表');
    await page.getByRole('button',{name:'筛选',exact:true}).click();assert.equal(await page.locator('.draft-task-table tbody>tr').count(),10);
    await filter.selectOption('succeeded');await page.getByRole('button',{name:'筛选',exact:true}).click();assert.equal(await page.locator('.draft-task-table tbody>tr').count(),0);
    await page.getByText('共 0 条记录',{exact:true}).waitFor();
    await page.getByRole('button',{name:'清空',exact:true}).click();assert.equal(await page.locator('.draft-task-table tbody>tr').count(),11);
    await page.getByRole('combobox',{name:'筛选执行模式',exact:true}).selectOption('auto');await page.getByRole('button',{name:'筛选',exact:true}).click();assert.equal(await page.locator('.draft-task-table tbody>tr').count(),0);
    await capture('automatic-filter-empty');
    await page.getByRole('button',{name:'清空',exact:true}).click();
    await page.getByRole('textbox',{name:'搜索任务',exact:true}).fill(original.title);assert.equal(await page.locator('.draft-task-table tbody>tr').count(),1);
    await page.getByRole('button',{name:'清空',exact:true}).click();
    }
    const target=createdIds[0];
    await menu('任务中心');
    if(options.resume)await page.getByRole('textbox',{name:'搜索任务',exact:true}).fill('任务状态真实出片验收');
    if(options.resume){
      assert.equal((await summary(target)).status,'failed');
      await row(target).getByText('失败',{exact:true}).waitFor();
      await capture('real-render-prerequisite-failed');
      report.assertions.push({name:'首次真实剪辑前置失败被正确保留',error:read().runs.find(run=>run.draftId===target&&run.status==='failed')?.error});
      await page.getByRole('button',{name:'清空',exact:true}).click();
      await page.getByRole('combobox',{name:'每页条数',exact:true}).selectOption('10');
      assert.equal(await page.locator('.draft-task-table tbody>tr').count(),10);
      await page.getByRole('button',{name:'下一页',exact:true}).click();assert.equal(await page.locator('.draft-task-table tbody>tr').count(),1);
      await page.getByRole('combobox',{name:'每页条数',exact:true}).selectOption('20');assert.equal(await page.locator('.draft-task-table tbody>tr').count(),11);
      const filter=page.getByRole('combobox',{name:'筛选任务状态',exact:true});
      for(const [status,count] of [['pending',9],['failed',1],['succeeded',0]]){await filter.selectOption(status);await page.getByRole('button',{name:'筛选',exact:true}).click();assert.equal(await page.locator('.draft-task-table tbody>tr').count(),count);}
      await page.getByRole('button',{name:'清空',exact:true}).click();
      await page.getByRole('combobox',{name:'筛选执行模式',exact:true}).selectOption('auto');await page.getByRole('button',{name:'筛选',exact:true}).click();assert.equal(await page.locator('.draft-task-table tbody>tr').count(),0);
      report.assertions.push({name:'恢复同一专项后分页及状态/模式筛选复核',taskCount:11,pending:9,failed:1,succeeded:0,automatic:0});
    }
    await page.getByRole('button',{name:'清空',exact:true}).click();
    await page.getByRole('combobox',{name:'每页条数',exact:true}).selectOption('20');
    await row(target).getByRole('button',{name:'继续',exact:true}).click();
    if(!options.resume){
    await title('任务状态真实出片验收');
    await page.locator('.steps>button').nth(6).click();
    assert.equal((await summary(target)).progress,0);
    await page.locator('.steps>button').nth(0).click();
    await page.locator('.main-tabs').getByRole('button',{name:'提取文案',exact:true}).click();
    await page.getByRole('textbox',{name:'原文案',exact:true}).fill('本次验收使用已有画中画视频，检查任务进度与当前产物，不生成克隆声音或数字人。');
    await page.locator('.steps>button').nth(1).click();
    await page.getByRole('textbox',{name:'改写内容',exact:true}).fill('任务中心真实状态验收文案。');
    await page.getByRole('button',{name:'确认使用',exact:true}).click();
    await page.locator('.steps>button').nth(4).click();
    await page.getByRole('button',{name:'修改',exact:true}).click();
    await page.getByRole('dialog',{name:'选择剪辑视频',exact:true}).getByRole('button').filter({hasText:'画中画验收主视频.mp4'}).click();
    }
    await page.locator('.steps>button').nth(4).click();
    if(options.resume){
      await page.getByRole('button',{name:'剪辑视频',exact:true}).click();
      await page.getByRole('status').filter({hasText:'字幕已开启，请先生成或导入并确认字幕，或关闭字幕'}).waitFor();
      await menu('任务中心');await row(target).getByText('失败',{exact:true}).waitFor();
      assert.equal((await page.locator('.stat-grid article>strong').allTextContents())[3],'1');
      await capture('failure-state-refreshed-after-action');
      await row(target).getByRole('button',{name:'继续',exact:true}).click();
    }
    await page.getByRole('button',{name:'编辑字幕',exact:true}).click();
    await page.getByRole('dialog',{name:'编辑字幕',exact:true}).getByRole('button',{name:'导入 SRT',exact:true}).click();
    await page.getByRole('dialog').last().getByRole('button').filter({hasText:'逐句画中画字幕.srt'}).click();
    await page.getByRole('dialog',{name:'编辑字幕',exact:true}).getByRole('button',{name:'确定',exact:true}).click();
    await page.getByRole('button',{name:'剪辑视频',exact:true}).click();
    await until(()=>{const latest=read().runs.find(run=>run.draftId===target&&run.type==='render');if(latest?.status==='failed')throw new Error('真实剪辑失败：'+latest.error);return !!read().drafts.find(item=>item.id===target).edit.resultId;},'真实剪辑产物',90000);
    await until(()=>read().runs.some(run=>run.draftId===target&&run.type==='render'&&run.status==='succeeded'),'真实剪辑成功');
    await page.locator('.steps>button').nth(5).click();
    await page.getByRole('button',{name:'编辑文字',exact:true}).click();await page.getByLabel('标题文字',{exact:true}).fill('任务状态验收');
    await page.getByRole('button',{name:'生成并导出封面',exact:true}).click();
    await until(()=>!!read().drafts.find(item=>item.id===target).cover.assetId,'真实PNG封面');
    await page.locator('.steps>button').nth(6).click();
    await page.getByRole('button',{name:'导出发布包',exact:true}).click();
    await page.getByRole('dialog',{name:'发布包已导出',exact:true}).waitFor();await page.keyboard.press('Escape');
    const product=read().drafts.find(item=>item.id===target),publish=read().publishRecords.find(item=>item.id===product.publish.recordId);
    assert(publish);assert(fs.existsSync(path.join(publish.directory,'video.mp4')));assert(fs.existsSync(path.join(publish.directory,'cover.png')));
    const result=await summary(target);assert.equal(result.progress,71);assert.equal(result.completedStages,5);assert.equal(result.stages[2].available,false);assert.equal(result.stages[6].available,false);assert.equal(result.exportStatus,'exported');assert.equal(result.status,'running');
    await menu('任务中心');await page.getByRole('textbox',{name:'搜索任务',exact:true}).fill('任务状态真实出片验收');
    await row(target).getByRole('button',{name:'详情',exact:true}).click();
    await dialog.locator('.modal-body').evaluate(element=>element.scrollTop=element.scrollHeight);
    await dialog.getByText('已导出，待发布',{exact:true}).waitFor();await capture('detail-real-products-bottom');
    await dialog.locator('[data-stage="edit"]').getByRole('button',{name:'查看执行',exact:true}).click();
    await page.getByRole('dialog',{name:'执行详情',exact:true}).waitFor();await page.keyboard.press('Escape');await dialog.waitFor();
    await page.keyboard.press('Escape');
    report.assertions.push({name:'十一任务分页、状态/模式筛选与搜索；真实剪辑/封面/导出不冒充发布',taskId:target,result,renderAssetId:product.edit.resultId,coverAssetId:product.cover.assetId,publishDirectory:publish.directory});
    await page.getByRole('button',{name:'清空',exact:true}).click();
    await page.getByRole('combobox',{name:'每页条数',exact:true}).selectOption('20');
    for(const id of createdIds){await row(id).getByRole('button',{name:'删除',exact:true}).click();await page.getByRole('dialog',{name:'删除创作任务',exact:true}).getByRole('button',{name:'删除',exact:true}).click();await until(()=>!read().drafts.some(item=>item.id===id),'仅删除临时任务');await until(()=>page.getByRole('dialog',{name:'删除创作任务',exact:true}).count().then(count=>count===0),'删除弹窗关闭');}
    assert.deepEqual(read().drafts.map(item=>item.id),initial.drafts.map(item=>item.id));
    assert.deepEqual(read().drafts.find(item=>item.id===original.id),original);
    assert(read().assets.some(item=>item.id===product.edit.resultId));
    await row(original.id).getByRole('button',{name:'继续',exact:true}).click();await menu('任务中心');
    report.assertions.push({name:'临时任务全部清理、原任务未改、实际产物保留',remainingIds:read().drafts.map(item=>item.id)});
    assert.deepEqual(report.pageErrors,[]);report.passed=true;return report;
  }catch(error){report.passed=false;report.error=error.stack;await capture('failure').catch(()=>{});throw error;}
  finally{page.off('pageerror',errorListener);fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));}
};
