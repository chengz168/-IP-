const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

// 通过真实表单修改和恢复隔离任务，不请求模型生成，也不替换业务数据文件。
module.exports = async function verifyLearningBindings(page) {
  const stateFile = path.resolve('evidence/validation/pip-desktop-workspace/studio.json');
  const directory = path.resolve('evidence/validation/learning-bindings');
  fs.mkdirSync(directory, {recursive:true});
  const read = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const before = read();
  const original = before.drafts.find(item => item.id === before.currentId);
  const current = () => read().drafts.find(item => item.id === original.id);
  const report = {checkedAt:new Date().toISOString(), window:await page.evaluate(() => [innerWidth, innerHeight]), assertions:[], pageErrors:[]};
  const onError = error => report.pageErrors.push(error.message);
  page.on('pageerror', onError);
  async function until(check, label) {
    const started = Date.now();
    while (Date.now() - started < 15000) {
      if (await check()) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('等待实际结果超时：'+label);
  }
  async function workflow(tab) {
    await page.getByRole('button', {name:'菜单', exact:true}).click();
    await page.getByRole('navigation', {name:'主菜单'}).getByRole('button', {name:'新工作流', exact:true}).click();
    await page.locator('.steps>button').nth(0).click();
    await page.locator('.main-tabs').getByRole('button', {name:tab, exact:true}).click();
  }
  async function topicValues(values) {
    const form = page.locator('.topic-form');
    await form.getByLabel('行业或产品').fill(values.industry);
    await form.getByLabel('人设方向').selectOption(values.persona);
    await form.getByLabel('目标人群').fill(values.audience);
    await form.getByLabel('我的人设').fill(values.bio);
  }
  async function marketingValues(values) {
    const form = page.locator('.marketing-form');
    for (const [label, key] of [['产品名称','name'],['目标人群','audience'],['产品卖点','selling'],['我的人设','persona'],['营销活动','offer']]) {
      await form.getByLabel(label, {exact:true}).fill(values[key]);
    }
  }
  try {
    assert.deepEqual(report.window, [1100, 760]);
    await workflow('爆款选题');
    const topic = {industry:'本轮布局验收行业', persona:'行业专家', audience:'本轮验收人群', bio:'验证两列表单改动后的人设介绍能够真实保存。'};
    await topicValues(topic);
    await until(() => JSON.stringify(current().topic) === JSON.stringify(topic), '选题字段落盘');
    await page.reload(); await workflow('爆款选题');
    assert.equal(await page.locator('.topic-form').getByLabel('我的人设').inputValue(), topic.bio);
    assert.equal(await page.locator('.topic-form').getByLabel('目标人群').inputValue(), topic.audience);
    assert.equal(await page.locator('.topic-form').getByLabel('人设方向').inputValue(), topic.persona);
    const runsBefore = read().runs.length;
    await page.locator('.topic-form').getByLabel('行业或产品').fill('');
    await page.getByRole('button', {name:'生成选题', exact:true}).click();
    await page.getByRole('status').filter({hasText:'请填写行业或产品'}).waitFor();
    assert.equal(read().runs.length, runsBefore);
    report.assertions.push({name:'选题字段保存、刷新恢复和必填拦截', values:topic, noRunOnEmpty:true});
    await topicValues(original.topic);
    await until(() => JSON.stringify(current().topic) === JSON.stringify(original.topic), '恢复原选题');

    await page.locator('.main-tabs').getByRole('button', {name:'营销文案', exact:true}).click();
    const marketing = {name:'布局验收产品', audience:'本轮验收人群', selling:'本轮验证输入与保存', persona:'行业专家', offer:'本轮验证活动'};
    await marketingValues(marketing);
    await page.getByLabel('字数限制', {exact:true}).selectOption('custom');
    assert.equal(await page.getByLabel('自定义字数', {exact:true}).inputValue(), '500');
    await page.getByLabel('自定义字数', {exact:true}).fill('137');
    await until(() => current().wordLimit === '137' && JSON.stringify(current().marketing) === JSON.stringify(marketing), '营销和自定义字数落盘');
    await page.reload(); await workflow('营销文案');
    assert.equal(await page.getByLabel('自定义字数', {exact:true}).inputValue(), '137');
    for (const [label, key] of [['产品名称','name'],['目标人群','audience'],['产品卖点','selling'],['我的人设','persona'],['营销活动','offer']]) {
      assert.equal(await page.locator('.marketing-form').getByLabel(label, {exact:true}).inputValue(), marketing[key]);
    }
    const button = page.getByRole('button', {name:'生成文案', exact:true});
    await page.locator('.stage-body').evaluate(element => element.scrollTop = element.scrollHeight);
    await button.scrollIntoViewIfNeeded();
    const buttonBox = await button.boundingBox();
    const panelBox = await page.locator('.stage-body').boundingBox();
    assert(buttonBox.y >= panelBox.y && buttonBox.y + buttonBox.height <= panelBox.y + panelBox.height + 1);
    await page.screenshot({path:path.join(directory, 'marketing-scrolled-1100.png')});
    await page.locator('.marketing-form').getByLabel('产品名称', {exact:true}).fill('');
    await page.locator('.marketing-form').getByLabel('产品卖点', {exact:true}).fill('');
    await button.click();
    await page.getByRole('status').filter({hasText:'请至少输入产品名称或卖点'}).waitFor();
    assert.equal(read().runs.length, runsBefore);
    await page.locator('.marketing-form').getByLabel('产品名称', {exact:true}).fill(marketing.name);
    await page.getByLabel('自定义字数', {exact:true}).fill('0');
    await button.click();
    await page.getByRole('status').filter({hasText:'字数限制请输入正整数'}).waitFor();
    assert.equal(read().runs.length, runsBefore);
    report.assertions.push({name:'营销字段、自定义137字、刷新恢复、空提交、非法字数和窄窗滚动', values:marketing, buttonBox, panelBox, noRunOnInvalid:true});
    await marketingValues(original.marketing);
    const presets = ['200','300','500','800','1000'];
    await page.getByLabel('字数限制', {exact:true}).selectOption(presets.includes(String(original.wordLimit)) ? String(original.wordLimit) : 'custom');
    if (!presets.includes(String(original.wordLimit))) await page.getByLabel('自定义字数', {exact:true}).fill(String(original.wordLimit));
    await until(() => current().wordLimit === original.wordLimit && JSON.stringify(current().marketing) === JSON.stringify(original.marketing), '恢复原营销配置');
    await page.locator('.main-tabs').getByRole('button', {name:'IP大脑', exact:true}).click();
    const brain = await page.locator('.brain-columns').evaluate(element => ({height:element.getBoundingClientRect().height, minHeight:getComputedStyle(element).minHeight}));
    assert(brain.height >= 350 && brain.height <= 544); assert.equal(brain.minHeight, '350px');
    const brainButton = await page.locator('.brain-form>.primary').boundingBox();
    const stage = await page.locator('.stage-body').boundingBox();
    assert(brainButton.y >= stage.y && brainButton.y + brainButton.height <= stage.y + stage.height + 1);
    report.assertions.push({name:'IP大脑独立高度规则生效', ...brain});
    assert.deepEqual(report.pageErrors, []);
    report.passed = true;
    return report;
  } catch (error) {
    report.passed = false; report.error = error.stack;
    await page.screenshot({path:path.join(directory, 'failure.png')}).catch(() => {});
    throw error;
  } finally {
    page.off('pageerror', onError);
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  }
};
