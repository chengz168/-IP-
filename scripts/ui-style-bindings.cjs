const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

module.exports = async function verifyStyleBindings(page) {
  const root = path.resolve('evidence/validation/pip-desktop-workspace');
  const stateFile = path.join(root, 'studio.json');
  const read = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const initial = read();
  const currentId = initial.currentId;
  const originalDraft = initial.drafts.find(item => item.id === currentId);
  const report = {checkedAt:new Date().toISOString(), workspace:root, assertions:[], pageErrors:[]};
  const directory = path.resolve('evidence/validation/style-bindings');
  fs.mkdirSync(directory, {recursive:true});
  const onError = error => report.pageErrors.push(error.message);
  page.on('pageerror', onError);
  const record = (name, data) => report.assertions.push({name, ...data});
  async function until(check, label) {
    const start = Date.now();
    while (Date.now() - start < 15000) {
      if (await check()) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('等待实际结果超时：'+label);
  }
  async function menu(name) {
    await page.getByRole('button', {name:'菜单', exact:true}).click();
    await page.getByRole('navigation', {name:'主菜单'}).getByRole('button', {name, exact:true}).click();
    if (name === '设置') await page.locator('.settings-nav').getByRole('button', {name:'常规设置', exact:true}).click();
  }
  const saveReport = () => fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  try {
    if (await page.getByRole('dialog', {name:'编辑字幕', exact:true}).count()) await page.getByRole('dialog').getByRole('button', {name:'取消', exact:true}).click();
    await menu('设置');
    const radio = page.getByRole('radio', {name:'旧工作流', exact:true});
    await radio.check();
    await page.getByRole('button', {name:'保存设置', exact:true}).click();
    await until(() => read().settings.view === 'old', '旧工作流设置落盘');
    const radioBox = await radio.boundingBox();
    assert.equal(radioBox.width, 16); assert.equal(radioBox.height, 16);
    await page.reload(); await page.locator('.legacy-page').waitFor();
    record('默认视图单选、保存、刷新生效', {savedView:read().settings.view, radioBox});
    await menu('设置');
    await page.getByRole('radio', {name:'新工作流', exact:true}).check();
    await page.getByRole('button', {name:'保存设置', exact:true}).click();
    await until(() => read().settings.view === 'new', '恢复默认视图');
    await page.locator('.settings-nav').getByRole('button', {name:'模型设置', exact:true}).click();
    const protocolBefore = read().settings.provider.textProtocol;
    await page.getByLabel('文本接入方式').selectOption('ollama');
    const context = page.getByLabel('本地上下文长度', {exact:true});
    const contextBefore = read().settings.provider.textContextTokens;
    await context.fill('8193');
    await page.getByRole('button', {name:'保存设置', exact:true}).click();
    await until(() => read().settings.provider.textContextTokens === '8193', '文本上下文保存');
    await page.reload(); await menu('设置');
    await page.locator('.settings-nav').getByRole('button', {name:'模型设置', exact:true}).click();
    assert.equal(await context.inputValue(), '8193');
    await context.fill(contextBefore);
    await page.getByLabel('文本接入方式').selectOption(protocolBefore);
    await page.getByRole('button', {name:'保存设置', exact:true}).click();
    await until(() => read().settings.provider.textContextTokens === contextBefore, '恢复原上下文');
    record('重排后的模型表单真实保存与刷新恢复', {saved:'8193', restored:contextBefore, restoredProtocol:protocolBefore});

    await menu('素材管理');
    await page.getByRole('button', {name:'新建分类', exact:true}).click();
    await page.getByRole('dialog').getByRole('textbox').fill('本轮取消分类');
    await page.getByRole('dialog').getByRole('button', {name:'取消', exact:true}).click();
    assert(!read().categories.includes('本轮取消分类'));
    await page.locator('.category-nav').getByRole('button', {name:'逐句验收'}).click();
    const expected = read().assets.filter(asset => asset.category === '逐句验收' && asset.type === 'image');
    await page.locator('.asset-content-heading').getByRole('button', {name:'图片', exact:true}).click();
    assert.equal(await page.locator('.asset-grid>.asset-card').count(), expected.length);
    await page.getByRole('textbox', {name:'搜索素材', exact:true}).fill('不存在的素材名称');
    await page.getByRole('heading', {name:'暂无素材', exact:true}).waitFor();
    await page.getByRole('textbox', {name:'搜索素材', exact:true}).fill('');
    await page.locator('.asset-content-heading').getByRole('button', {name:'全部', exact:true}).click();
    record('素材分类、类型、搜索及取消新建', {imageCount:expected.length});

    await menu('账号管理');
    await page.getByRole('button', {name:'添加账号', exact:true}).click();
    const accountDialog = page.getByRole('dialog', {name:'添加账号', exact:true});
    await accountDialog.getByPlaceholder('输入账号名称或用户名').fill('本轮布局取消账号');
    await accountDialog.getByPlaceholder('输入显示名称（可选）').fill('显示名称校验');
    const accountBox = await accountDialog.boundingBox();
    await accountDialog.getByRole('button', {name:'取消', exact:true}).click();
    assert.equal(read().accounts.length, initial.accounts.length);
    record('账号表单显示名称、取消不新增、弹窗尺寸', {accountBox});

    await menu('新工作流'); await page.locator('.steps>button').nth(4).click();
    await page.getByRole('button', {name:'编辑字幕', exact:true}).click();
    let captionDialog = page.getByRole('dialog', {name:'编辑字幕', exact:true});
    const captionBox = await captionDialog.boundingBox();
    const insertionIndex = originalDraft.edit.captions.findIndex((row, index, all) => index + 1 < all.length && all[index+1].start > row.end);
    assert(insertionIndex >= 0);
    const tableRows = captionDialog.locator('tbody>tr');
    await tableRows.nth(insertionIndex).getByRole('button', {name:'插入', exact:true}).click();
    assert.equal(await tableRows.count(), originalDraft.edit.captions.length + 1);
    const inserted = tableRows.nth(insertionIndex + 1);
    assert.equal(Number(await inserted.getByLabel('字幕开始时间').inputValue()), originalDraft.edit.captions[insertionIndex].end);
    assert.equal(Number(await inserted.getByLabel('字幕结束时间').inputValue()), originalDraft.edit.captions[insertionIndex+1].start);
    await captionDialog.getByRole('button', {name:'取消', exact:true}).click();
    await page.getByRole('button', {name:'编辑字幕', exact:true}).click();
    assert.equal(await tableRows.count(), originalDraft.edit.captions.length + 1);
    await tableRows.nth(insertionIndex + 1).getByRole('button', {name:'删除字幕', exact:true}).click();
    await captionDialog.getByRole('button', {name:'导入 SRT', exact:true}).click();
    await page.getByRole('dialog', {name:'导入SRT字幕', exact:true}).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 1);
    assert.equal(await captionDialog.count(), 1);
    await tableRows.nth(0).getByLabel('字幕结束时间').fill('0');
    await captionDialog.getByRole('button', {name:'确定', exact:true}).click();
    await page.getByRole('status').filter({hasText:'第 1 条字幕时间无效'}).waitFor();
    assert.equal(await captionDialog.count(), 1);
    await tableRows.nth(0).getByLabel('字幕结束时间').fill(String(originalDraft.edit.captions[0].end));
    await captionDialog.getByRole('button', {name:'确定', exact:true}).click();
    await until(() => JSON.stringify(read().drafts.find(draft => draft.id === currentId).edit.captions) === JSON.stringify(originalDraft.edit.captions), '字幕恢复原配置并落盘');
    record('字幕插入间隙、取消保留、删除恢复、非法时间拦截、嵌套Escape只关顶层', {captionBox, insertionIndex, restoredCaptions:originalDraft.edit.captions.length});

    await menu('任务中心');
    const addedIds = [];
    for (let index=0; index<10; index++) {
      await page.locator('.task-title-actions').getByRole('button', {name:'新建任务', exact:true}).click();
      await page.locator('.steps>button').first().waitFor();
      const createdId = read().currentId;
      assert(!initial.drafts.some(draft => draft.id === createdId));
      addedIds.push(createdId);
      await menu('任务中心');
    }
    assert.equal(await page.locator('.task-table tbody>tr').count(), 10);
    await page.getByRole('button', {name:'下一页', exact:true}).click();
    assert.equal(await page.locator('.task-table tbody>tr').count(), 1);
    assert.equal(await page.locator('.page-number').innerText(), '2');
    await page.getByRole('combobox', {name:'每页条数', exact:true}).selectOption('20');
    assert.equal(await page.locator('.task-table tbody>tr').count(), 11);
    assert.equal(await page.locator('.page-number').innerText(), '1');
    await page.getByRole('textbox', {name:'搜索任务', exact:true}).fill(originalDraft.title);
    assert.equal(await page.locator('.task-table tbody>tr').count(), 1);
    await page.getByRole('textbox', {name:'搜索任务', exact:true}).fill('');
    await page.screenshot({path:path.join(directory, 'tasks-pagination.png')});
    // 仅删除本脚本通过按钮新建的十个验收任务，保留原验收任务和素材。
    for (const id of addedIds) {
      assert(!initial.drafts.some(draft => draft.id === id));
      const row = page.locator('.task-table tbody>tr').filter({hasText:'新建创作任务'}).first();
      await row.getByRole('button', {name:'删除', exact:true}).click();
      await page.getByRole('dialog', {name:'删除创作任务', exact:true}).getByRole('button', {name:'删除', exact:true}).click();
      await page.getByRole('dialog', {name:'删除创作任务', exact:true}).waitFor({state:'hidden'});
      await page.getByRole('combobox', {name:'每页条数', exact:true}).selectOption('20');
    }
    assert.deepEqual(read().drafts.map(draft => draft.id), initial.drafts.map(draft => draft.id));
    await page.locator('.task-table tbody>tr').filter({hasText:originalDraft.title}).getByRole('button', {name:'继续', exact:true}).click();
    record('真实创建11条列表、第二页、每页20、搜索与删除恢复', {temporaryDraftIds:addedIds, retainedId:currentId});
    assert.deepEqual(report.pageErrors, []);
    report.passed = true;
    return report;
  } catch (error) {
    report.passed = false; report.error = error.stack;
    await page.screenshot({path:path.join(directory, 'failure.png')}).catch(() => {});
    throw error;
  } finally {page.off('pageerror', onError); saveReport();}
};
