const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {Providers} = require('../server/providers.cjs');

function fixture(t, config = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sip-release-boundary-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const provider = new Providers({root, data: {settings: {provider: {baseUrl: 'https://cloud.invalid/v1', model: 'test', textProtocol: 'compatible', ...config}}}}, null, {get: async () => ''});
  return {root, provider};
}

test('P1-A回归：空输出配置的实际云端请求上限与预算预留一致', async t => {
  for (const config of [{}, {textMaxTokens: ''}]) {
    const {provider} = fixture(t, config); let body, reserved;
    provider.request = async (_url, options) => {
      body = JSON.parse(options.body);
      reserved = provider.usageGuard.info().reservedTokens;
      return {json: async () => ({choices: [{message: {content: '截获回包'}, finish_reason: 'stop'}], usage: {total_tokens: 20}})};
    };
    const result = await provider.text('s', 'u', {});
    assert.equal(body.max_tokens, 2048); assert.equal(result.request.parameters.max_tokens, body.max_tokens);
    assert.equal(reserved, Buffer.byteLength('su') + body.max_tokens);
    assert.equal(provider.usageGuard.info().tokens, 20);
  }
});

test('P1-B回归：远程Ollama文本与视觉保留原协议并计入同一云端账本', async t => {
  const {provider} = fixture(t, {baseUrl: 'https://remote-ollama.example/v1', textProtocol: 'ollama', visionProtocol: 'ollama', visionModel: 'test'});
  const requests = [];
  provider.request = async (url, options) => { requests.push({url, body: JSON.parse(options.body)}); return {json: async () => ({message: {content: '截获回包'}, done_reason: 'stop', prompt_eval_count: 20, eval_count: 20})}; };
  await provider.text('s', 'u', {}); await provider.vision('s', 'u', ['QQ=='], {});
  assert(requests.every(item => item.url === 'https://remote-ollama.example/api/chat'));
  assert(requests.every(item => item.body.options.num_predict > 0));
  const state = provider.usageGuard.info(); assert.equal(state.requests, 2); assert.equal(state.tokens, 80); assert.equal(state.estimatedTokens, 0);
});

test('P1-B回归：远程Ollama三次失败后在第四次真实提交前熔断', async t => {
  const {provider} = fixture(t, {baseUrl: 'https://remote-ollama.example/v1', textProtocol: 'ollama'});
  let submissions = 0; provider.request = async () => { submissions++; throw Error('合成上游故障'); };
  for (let index = 0; index < 3; index++) await assert.rejects(provider.text('s', 'u', {}), /合成上游故障/);
  await assert.rejects(provider.text('s', 'u', {}), /今日已暂停调用/);
  assert.equal(submissions, 3); assert.equal(provider.usageGuard.info().circuitOpen.text, true);
});

test('P1-B回归：三类本机回环Ollama仍不消耗云端额度', async t => {
  for (const baseUrl of ['http://localhost:11434', 'http://127.0.0.1:11434/v1', 'http://[::1]:11434']) {
    const {root, provider} = fixture(t, {baseUrl, textProtocol: 'ollama'});
    provider.request = async () => ({json: async () => ({message: {content: '截获本机回包'}, done_reason: 'stop', prompt_eval_count: 20, eval_count: 20})});
    await provider.text('s', 'u', {});
    assert.equal(fs.existsSync(path.join(root, 'usage.json')), false);
  }
});

test('P1-C回归：执行App真实响应式代码，暂时探测失败和恢复均保留创作区', async () => {
  const {ref, computed} = require('vue'), ui = await import('../src/release-ui.mjs');
  const source = fs.readFileSync(path.join(__dirname, '../src/App.vue'), 'utf8');
  const begin = source.indexOf('const environmentReport='), end = source.indexOf('let environmentPolledAt=0;', begin);
  assert(begin >= 0 && end > begin, 'App环境状态区域已变动，请调整集成测试加载范围');
  const module = {exports: {}}; let rejectProbe = false;
  // 直接执行现有App逻辑，只替换API边界，不在测试中复制向导显示条件。
  vm.runInNewContext(source.slice(begin, end) + '\nmodule.exports={wizardAccepted,environmentReport,wizardVisible,checkEnvironment,creationReady};', {module, ref, computed, state: ref({license: {activated: true}}), page: ref('workflow'), call: async () => { if (rejectProbe) throw Error('合成连接中断'); return {canCreate: true, items: [{id: 'text', status: 'ready'}]}; }, refresh: async () => {}, notify() {}, navigate: async () => {}, ...ui, localEnvironmentSummary() {}, Date});
  const app = module.exports;
  assert.equal(app.wizardVisible.value, true);
  await app.checkEnvironment(); assert.equal(app.creationReady.value, true);
  app.wizardAccepted.value = true; assert.equal(app.wizardVisible.value, false);
  rejectProbe = true; await app.checkEnvironment(); assert.equal(app.creationReady.value, false); assert.equal(app.wizardVisible.value, false);
  rejectProbe = false; await app.checkEnvironment(); assert.equal(app.creationReady.value, true); assert.equal(app.wizardVisible.value, false);
  app.wizardAccepted.value = false; assert.equal(app.wizardVisible.value, true);
});
