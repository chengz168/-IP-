const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vue = require('vue');
const sfc = require('@vue/compiler-sfc');
const {renderToString} = require('@vue/server-renderer');
const filename = path.resolve(__dirname, '../src/components/CaptionEditor.vue');
const {descriptor} = sfc.parse(fs.readFileSync(filename, 'utf8'), {filename});

async function fixture(t, props = {}, options = {}) {
  const helpers = {...await import('../src/caption-edit-session.mjs'), ...await import('../src/caption-edit-rules.mjs')};
  const draft = vue.ref({id: 'isolated-caption', video: {assetId: 'isolated-video'}, edit: {subtitleMode: 'template', captions: options.empty ? [] : [{start: 0, end: 1, text: '先保存再回听'}]}, artifacts: {captionHistory: [{id: 'history'}]}});
  const state = vue.ref({assets: [{id: 'isolated-video', duration: 2}], runs: []}), busy = vue.ref(''), events = [];
  const studio = {draft, state, busy, notify: message => events.push(message), act: async (_, work) => work(), save: async () => {events.push('save'); if (options.saveFails) throw Error('隔离保存失败');}};
  const source = sfc.compileScript(descriptor, {id: 'caption-entry'}).content.replace(/^import .*;\r?\n/gm, '').replace('export default', 'return');
  const slot = {setup: (_, context) => () => vue.h('section', [context.slots.default?.(), context.slots.footer?.()])};
  const names = ['computed', 'inject', 'ref', 'nextTick', 'onMounted', 'onUnmounted', 'Modal', 'I', 'SubtitleProofread', 'CaptionHistory', 'call', ...Object.keys(helpers)];
  const values = [vue.computed, () => studio, vue.ref, vue.nextTick, () => {}, () => {}, slot, slot, {render: () => vue.h('div', {'data-proofread': 'open'})}, slot, () => assert.fail('入口测试不得调用真实IPC'), ...Object.values(helpers)];
  const component = new Function(...names, source)(...values);
  component.components = {Modal: slot, I: slot, SubtitleProofread: values[8], CaptionHistory: slot};
  const compiled = sfc.compileTemplate({id: 'caption-entry', filename, source: descriptor.template.content, compilerOptions: {mode: 'function'}});
  assert.deepEqual(compiled.errors, []);
  component.render = new Function('Vue', compiled.code)(vue);
  const originalSetup = component.setup;
  let vm;
  component.setup = (actualProps, context) => {
    vm = originalSetup(actualProps, context);
    // 独立编译模板通过普通组件代理读取setup返回值，不挂载任何正式页面。
    return {...vm};
  };
  const app = vue.createSSRApp({render: () => vue.h(component, props)}), warnings = [];
  app.config.warnHandler = message => warnings.push(message);
  const html = await renderToString(app);
  assert.deepEqual(warnings, []);
  return {html, vm, draft, busy, events};
}

test('新版独立开启校对，译文关键词和历史继续隐藏，旧版辅助入口保持可见', async t => {
  const modern = await fixture(t, {proofreadTools: true});
  assert.match(modern.html, /按文案校对/);
  assert.doesNotMatch(modern.html, /译文与关键词|生成双语译文|字幕历史|英语译文/);
  assert.equal(modern.vm.showAuxiliary.value, false);
  const old = await fixture(t, {auxiliaryTools: true});
  assert.match(old.html, /按文案校对/);
  assert.match(old.html, /译文与关键词/);
  assert.match(old.html, /字幕历史/);
  const disabled = await fixture(t);
  assert.doesNotMatch(disabled.html, /按文案校对|译文与关键词/);
});

test('校对打开前保存当前临时字幕，失败或忙碌不打开校对', async t => {
  const f = await fixture(t, {proofreadTools: true});
  f.vm.rows.value[0].text = '临时修订';
  assert.equal(f.draft.value.edit.captions[0].text, '先保存再回听');
  await f.vm.openAuxiliary('proofread');
  assert.deepEqual(f.events, ['save']);
  assert.equal(f.draft.value.edit.captions[0].text, '临时修订');
  assert.equal(f.vm.proofreadOpen.value, true);
  const failed = await fixture(t, {proofreadTools: true}, {saveFails: true});
  await failed.vm.openAuxiliary('proofread');
  assert.equal(failed.vm.proofreadOpen.value, false);
  assert.match(failed.vm.auxiliaryError.value, /保存失败/);
  const busy = await fixture(t, {proofreadTools: true});
  busy.busy.value = '处理中';
  await busy.vm.openAuxiliary('proofread');
  assert.equal(busy.vm.proofreadOpen.value, false);
  assert.deepEqual(busy.events, []);
});

test('空字幕仍显示但禁用校对，新工作流只传独立开关且不改变容器定位条件', async t => {
  const empty = await fixture(t, {proofreadTools: true}, {empty: true});
  assert.match(empty.html, /<button disabled[^>]*>按文案校对<\/button>/);
  const workflow = fs.readFileSync(path.resolve(__dirname, '../src/views/Workflow.vue'), 'utf8');
  const modernEntry = workflow.match(/<CaptionEditor\b[^>]*\/>/)[0];
  assert.match(modernEntry, /\bproofread-tools\b/);
  assert.doesNotMatch(modernEntry, /auxiliary-tools/);
  assert.match(descriptor.scriptSetup.content, /if\(props\.auxiliaryTools\)return;/);
  assert.match(descriptor.scriptSetup.content, /container&&!props\.auxiliaryTools/);
  assert.doesNotMatch(descriptor.scriptSetup.content, /if\(props\.proofreadTools\)return|container&&!props\.proofreadTools/);
});
