const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawn} = require('node:child_process');
const {createUsageGuard, usageTokens} = require('../server/usage-guard.cjs');

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'superip-usage-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const config = {root, now: () => new Date('2026-11-25T08:00:00.000Z'), ...options};
  return {root, config, guard: createUsageGuard(config), disk: () => JSON.parse(fs.readFileSync(path.join(root, 'usage.json'), 'utf8'))};
}
const cloud = (options = {}) => ({capability: 'text', protocol: 'compatible', reservedTokens: 1000, ...options});

test('默认额度为每日10次/200000token，云端按预留和真实usage结算，幂等不重复收费', t => {
  const f = fixture(t), ticket = f.guard.reserve(cloud()), pending = f.guard.info();
  assert.equal(pending.limits.dailyRequests, 10); assert.equal(pending.limits.dailyTokens, 200000); assert.equal(pending.requests, 1); assert.equal(pending.reservedTokens, 1000);
  const settled = f.guard.succeed(ticket, {prompt_tokens: 50, completion_tokens: 20, total_tokens: 70}); assert.equal(settled.tokens, 70); assert.equal(settled.estimated, false);
  assert.equal(f.guard.succeed(ticket, {total_tokens: 999}).duplicate, true); assert.equal(f.guard.fail(ticket).duplicate, true);
  const state = f.guard.info(); assert.equal(state.tokens, 70); assert.equal(state.reservedTokens, 0); assert.equal(state.requests, 1);
});

test('本地协议不计次数、token或失败，也不创建账本', t => {
  const f = fixture(t);
  for (const protocol of ['ollama', 'comfyui', 'comfy-h3', 'indextts-local', 'local-whisper', 'windows', 'musetalk-local']) {
    const ticket = f.guard.reserve({capability: 'text', protocol}); assert.equal(ticket.local, true);
    f.guard.succeed(ticket, {total_tokens: 1000000}); f.guard.fail(ticket);
  }
  assert.equal(fs.existsSync(path.join(f.root, 'usage.json')), false); assert.equal(fs.existsSync(path.join(f.root, 'usage.lock')), false);
});

test('云端次数池限制跨文本与视觉共享，拒绝发生在发请求前', t => {
  const f = fixture(t, {limits: {dailyRequests: 2}});
  f.guard.reserve(cloud()); f.guard.reserve(cloud({capability: 'vision'}));
  assert.throws(() => f.guard.reserve(cloud()), error => error.code === 'USAGE_REQUEST_LIMIT'); assert.equal(f.disk().days['2026-11-25'].requests, 2);
});

test('并发预留先占token预算，多个manager也无法分别穿透额度', t => {
  const f = fixture(t, {limits: {dailyTokens: 100}}), other = createUsageGuard(f.config), ticket = f.guard.reserve(cloud({reservedTokens: 60}));
  assert.throws(() => other.reserve(cloud({reservedTokens: 60})), error => error.code === 'USAGE_TOKEN_LIMIT');
  f.guard.succeed(ticket, {total_tokens: 10}); other.reserve(cloud({reservedTokens: 90}));
  assert.equal(f.guard.info().tokens + f.guard.info().reservedTokens, 100);
});

test('缺失或畸形usage保守记预留，不能当作0token退款', t => {
  const f = fixture(t);
  for (const usage of [null, {}, {total_tokens: -1}, {prompt_tokens: 5}, {total_tokens: '10'}, {total_tokens: Infinity}]) {
    const ticket = f.guard.reserve(cloud()); const result = f.guard.succeed(ticket, usage);
    assert.equal(result.tokens, 1000); assert.equal(result.estimated, true);
  }
  assert.equal(f.guard.info().estimatedTokens, 6000);
});

test('失败/取消不退已尝试次数，取消不计连续失败；真实失败仍记录usage', t => {
  const f = fixture(t), first = f.guard.reserve(cloud()); f.guard.fail(first, {usage: {total_tokens: 100}});
  const cancelled = f.guard.reserve(cloud()); const result = f.guard.fail(cancelled, {cancelled: true});
  assert.equal(result.status, 'cancelled'); assert.equal(result.tokens, 1000);
  const state = f.guard.info(); assert.equal(state.consecutiveFailures.text, 1); assert.equal(state.requests, 2); assert.equal(state.tokens, 1100); assert.equal(state.reservedTokens, 0);
});

test('某能力连续三次失败当日熔断，不影响另一能力，次日自动恢复', t => {
  let date = '2026-11-25T08:00:00.000Z'; const f = fixture(t, {now: () => new Date(date)});
  for (let i = 0; i < 3; i++) f.guard.fail(f.guard.reserve(cloud()));
  assert.throws(() => f.guard.reserve(cloud()), error => error.code === 'USAGE_CIRCUIT_OPEN');
  f.guard.succeed(f.guard.reserve(cloud({capability: 'vision'})), {total_tokens: 1});
  date = '2026-11-26T08:00:00.000Z'; assert.equal(f.guard.reserve(cloud()).day, '2026-11-26'); assert.equal(f.guard.info().circuitOpen.text, false);
});

test('成功清除连续失败计数，但迟到成功不能撤销已熔断状态', t => {
  const f = fixture(t);
  f.guard.fail(f.guard.reserve(cloud())); f.guard.fail(f.guard.reserve(cloud())); f.guard.succeed(f.guard.reserve(cloud()), {total_tokens: 1});
  assert.equal(f.guard.info().consecutiveFailures.text, 0);
  const late = f.guard.reserve(cloud());
  for (let i = 0; i < 3; i++) f.guard.fail(f.guard.reserve(cloud()));
  f.guard.succeed(late, {total_tokens: 1}); assert.equal(f.guard.info().circuitOpen.text, true);
  assert.throws(() => f.guard.reserve(cloud()), error => error.code === 'USAGE_CIRCUIT_OPEN');
});

test('七天滚动保留含当天，跨午夜结算记原请求日期，配置时区使用北京时间', t => {
  let date = '2026-11-18T15:59:00.000Z'; const f = fixture(t, {now: () => new Date(date)}), ticket = f.guard.reserve(cloud());
  date = '2026-11-18T16:01:00.000Z'; f.guard.succeed(ticket, {total_tokens: 7}); assert.equal(f.guard.info().day, '2026-11-19'); assert.equal(f.disk().days['2026-11-18'].tokens, 7);
  for (let day = 20; day <= 25; day++) { date = '2026-11-' + day + 'T08:00:00.000Z'; f.guard.info(); }
  assert.equal(Object.hasOwn(f.disk().days, '2026-11-18'), false); assert.equal(Object.keys(f.disk().days).length, 7);
});

test('重建manager保留预留、次数和熔断，不因重启重置', t => {
  const f = fixture(t), ticket = f.guard.reserve(cloud());
  const rebuilt = createUsageGuard(f.config); assert.equal(rebuilt.info().reservedTokens, 1000);
  rebuilt.fail(ticket); assert.equal(f.guard.info().consecutiveFailures.text, 1);
});

test('可动态配置额度，未知协议、能力、非整数预算和无效配置明确拒绝', t => {
  let limits = {dailyRequests: 1, dailyTokens: 100}; const f = fixture(t, {limits: () => limits}); f.guard.reserve(cloud({reservedTokens: 50}));
  assert.throws(() => f.guard.reserve(cloud({reservedTokens: 50})), error => error.code === 'USAGE_REQUEST_LIMIT');
  limits = {...limits, dailyRequests: 2}; f.guard.reserve(cloud({reservedTokens: 50}));
  for (const options of [{protocol: 'invented'}, {capability: 'tts'}, {reservedTokens: 0}, {reservedTokens: 1.5}]) assert.throws(() => f.guard.reserve(cloud(options)), error => error.code === 'USAGE_INVALID_INPUT');
  limits.dailyTokens = -1; assert.throws(() => f.guard.info(), error => error.code === 'USAGE_CONFIG_INVALID');
});

test('写盘失败不接受预留、不改旧账本，释放锁且不留下明文临时文件', t => {
  const f = fixture(t); f.guard.info(); const file = path.join(f.root, 'usage.json'), before = fs.readFileSync(file), rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => { if (to === file) throw Object.assign(Error('内部路径不得泄露'), {code: 'ENOSPC'}); return rename(from, to); });
  assert.throws(() => f.guard.reserve(cloud()), error => error.code === 'USAGE_SAVE_FAILED' && !error.message.includes(f.root));
  assert.deepEqual(fs.readFileSync(file), before); assert.equal(fs.existsSync(path.join(f.root, 'usage.lock')), false); assert.equal(fs.readdirSync(f.root).filter(name => name.endsWith('.tmp')).length, 0);
});

test('结算写盘失败保留未结算预留，之后可以用原凭据重试且不重复计数', t => {
  const f = fixture(t), ticket = f.guard.reserve(cloud()), rename = fs.renameSync; let shouldFail = true;
  t.mock.method(fs, 'renameSync', (from, to) => { if (to === path.join(f.root, 'usage.json') && shouldFail) throw Object.assign(Error('写盘失败'), {code: 'EIO'}); return rename(from, to); });
  assert.throws(() => f.guard.succeed(ticket, {total_tokens: 12}), error => error.code === 'USAGE_SAVE_FAILED');
  assert.equal(f.disk().days[ticket.day].reservedTokens, 1000);
  shouldFail = false; f.guard.succeed(ticket, {total_tokens: 12}); assert.equal(f.guard.info().tokens, 12); assert.equal(f.guard.info().requests, 1);
});

test('账本损坏或预留统计不一致时失败关闭，不覆盖原始记录', t => {
  const f = fixture(t), file = path.join(f.root, 'usage.json'); fs.writeFileSync(file, '{损坏');
  assert.throws(() => f.guard.reserve(cloud()), error => error.code === 'USAGE_READ_FAILED'); assert.equal(fs.readFileSync(file, 'utf8'), '{损坏');
  fs.unlinkSync(file); f.guard.reserve(cloud()); const state = f.disk(); state.days['2026-11-25'].reservedTokens = 0; fs.writeFileSync(file, JSON.stringify(state));
  assert.throws(() => f.guard.info(), error => error.code === 'USAGE_READ_FAILED');
});

test('活进程锁拒绝并发覆盖，锁损坏拒绝抢占，中文不泄露路径', t => {
  const f = fixture(t), file = path.join(f.root, 'usage.lock'); fs.writeFileSync(file, JSON.stringify({pid: process.pid, owner: 'other'}));
  assert.throws(() => f.guard.reserve(cloud()), error => error.code === 'USAGE_BUSY' && !error.message.includes(f.root));
  fs.writeFileSync(file, '坏锁'); assert.throws(() => f.guard.reserve(cloud()), error => error.code === 'USAGE_BUSY');
});

test('独立Node进程并发预留不能越过共享token预算', async t => {
  const f = fixture(t), modulePath = path.resolve(__dirname, '../server/usage-guard.cjs');
  const source = "const g=require(process.argv[1]).createUsageGuard({root:process.argv[2],limits:{dailyTokens:100}});try{g.reserve({capability:'text',protocol:'compatible',reservedTokens:60});process.stdout.write('reserved');}catch(e){process.stdout.write(e.code||'ERROR');}";
  const results = await Promise.all(Array.from({length: 6}, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', source, modulePath, f.root], {windowsHide: true}); let out = '', error = '';
    child.stdout.on('data', data => out += data); child.stderr.on('data', data => error += data); child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(out) : reject(Error(error)));
  })));
  assert.equal(results.filter(value => value === 'reserved').length, 1); assert(results.every(value => ['reserved', 'USAGE_BUSY', 'USAGE_TOKEN_LIMIT'].includes(value)));
  const data = JSON.parse(fs.readFileSync(path.join(f.root, 'usage.json'), 'utf8')); assert.equal(Object.values(data.days)[0].reservedTokens, 60);
});

test('服务返回用量超出预留仍如实入账并阻止继续调用，不虚构成本上限', t => {
  const f = fixture(t, {limits: {dailyTokens: 100}}), ticket = f.guard.reserve(cloud({reservedTokens: 80}));
  const result = f.guard.succeed(ticket, {total_tokens: 120}); assert.equal(result.exceeded, true); assert.equal(f.guard.info().tokens, 120);
  assert.throws(() => f.guard.reserve(cloud({reservedTokens: 1})), error => error.code === 'USAGE_TOKEN_LIMIT');
});

test('日期回拨不能重新获得额度，未知凭据和能力伪造不能结算', t => {
  let date = '2026-11-25T08:00:00.000Z'; const f = fixture(t, {now: () => new Date(date)}), ticket = f.guard.reserve(cloud());
  assert.throws(() => f.guard.succeed({...ticket, capability: 'vision'}, null), error => error.code === 'USAGE_TICKET_MISSING');
  assert.throws(() => f.guard.succeed({...ticket, id: 'unknown'}, null), error => error.code === 'USAGE_TICKET_MISSING');
  date = '2026-11-24T08:00:00.000Z'; assert.throws(() => f.guard.reserve(cloud()), error => error.code === 'USAGE_CLOCK_REVERSED');
});

test('usage选用有效total或完整输入输出和，矛盾时取较大值不低估', () => {
  assert.equal(usageTokens({total_tokens: 0}), 0);
  assert.equal(usageTokens({prompt_tokens: 2, completion_tokens: 3}), 5);
  assert.equal(usageTokens({total_tokens: 3, prompt_tokens: 4, completion_tokens: 5}), 9);
  assert.equal(usageTokens({prompt_tokens: 1}), null);
  assert.equal(usageTokens({total_tokens: Number.MAX_SAFE_INTEGER + 1}), null);
});

test('已结算总token与明细不一致时拒绝继续调用，不静默重置用量', t => {
  const f = fixture(t), ticket = f.guard.reserve(cloud()); f.guard.succeed(ticket, {total_tokens: 30});
  const state = f.disk(); state.days[ticket.day].tokens = 0; fs.writeFileSync(path.join(f.root, 'usage.json'), JSON.stringify(state));
  assert.throws(() => f.guard.reserve(cloud()), error => error.code === 'USAGE_READ_FAILED');
});

test('确认退出的进程留下的锁可回收，恢复后不清空既有用量', async t => {
  const f = fixture(t), ticket = f.guard.reserve(cloud()); f.guard.succeed(ticket, {total_tokens: 30});
  const child = spawn(process.execPath, ['-e', ''], {windowsHide: true}); const pid = child.pid;
  await new Promise((resolve, reject) => {child.on('error', reject); child.on('close', resolve);});
  fs.writeFileSync(path.join(f.root, 'usage.lock'), JSON.stringify({pid, owner: '已退出进程'}));
  f.guard.reserve(cloud()); assert.equal(f.guard.info().tokens, 30); assert.equal(f.guard.info().requests, 2);
});
