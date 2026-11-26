const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createUsageGuard} = require('../server/usage-guard.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-lock-contention-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const guard = createUsageGuard({root, limits: {dailyTokens: 100}, now: () => new Date('2026-11-26T00:00:00Z')});
  guard.info();
  const ledger = path.join(root, 'usage.json'), lock = path.join(root, 'usage.lock');
  const before = fs.readFileSync(ledger), retiredPid = 2147483000;
  fs.writeFileSync(lock, JSON.stringify({pid: retiredPid, owner: '已退出持有人'}));
  const kill = process.kill;
  t.mock.method(process, 'kill', (pid, signal) => {
    if (pid === retiredPid) throw Object.assign(new Error('持有人已退出'), {code: 'ESRCH'});
    return kill(pid, signal);
  });
  return {root, guard, ledger, lock, before};
}

for (const stage of ['first-read', 'second-read', 'unlink', 'reopen']) {
  test('用量锁竞争' + stage + '返回BUSY，旧账本不变且不清理竞争者锁', t => {
    const f = fixture(t), read = fs.readFileSync, unlink = fs.unlinkSync;
    let reads = 0, injected = false;
    if (stage === 'first-read' || stage === 'second-read') {
      t.mock.method(fs, 'readFileSync', function(file, ...args) {
        if (file === f.lock && ++reads === (stage === 'first-read' ? 1 : 2)) {
          injected = true;
          unlink(f.lock);
        }
        return read(file, ...args);
      });
    } else {
      t.mock.method(fs, 'unlinkSync', function(file, ...args) {
        if (file === f.lock && !injected) {
          injected = true;
          unlink(file);
          if (stage === 'reopen') {
            fs.writeFileSync(file, JSON.stringify({pid: process.pid, owner: '竞争者'}), {flag: 'wx'});
            return;
          }
        }
        return unlink(file, ...args);
      });
    }
    assert.throws(() => f.guard.reserve({capability: 'text', protocol: 'compatible', reservedTokens: 60}), error => error.code === 'USAGE_BUSY');
    assert.equal(injected, true);
    assert.deepEqual(read(f.ledger), f.before);
    if (stage === 'reopen') assert.equal(JSON.parse(read(f.lock, 'utf8')).owner, '竞争者');
    else assert.equal(fs.existsSync(f.lock), false);
    assert.equal(fs.readdirSync(f.root).some(name => name.endsWith('.tmp')), false);
  });
}

for (const stage of ['first-read', 'second-read', 'unlink', 'reopen']) {
  test('用量锁' + stage + '真实I/O失败仍为SAVE_FAILED，不误判繁忙', t => {
    const f = fixture(t), read = fs.readFileSync, unlink = fs.unlinkSync, open = fs.openSync;
    let reads = 0, opens = 0, injected = false;
    const failure = () => {injected = true; throw Object.assign(new Error('内部路径不应泄露'), {code: 'EACCES'});};
    if (stage === 'first-read' || stage === 'second-read') {
      t.mock.method(fs, 'readFileSync', function(file, ...args) {
        if (file === f.lock && ++reads === (stage === 'first-read' ? 1 : 2)) failure();
        return read(file, ...args);
      });
    } else if (stage === 'unlink') {
      t.mock.method(fs, 'unlinkSync', function(file, ...args) {
        if (file === f.lock) failure();
        return unlink(file, ...args);
      });
    } else {
      t.mock.method(fs, 'openSync', function(file, ...args) {
        if (file === f.lock && ++opens === 2) failure();
        return open(file, ...args);
      });
    }
    assert.throws(() => f.guard.reserve({capability: 'text', protocol: 'compatible', reservedTokens: 60}), error => error.code === 'USAGE_SAVE_FAILED' && !error.message.includes(f.root));
    assert.equal(injected, true);
    assert.deepEqual(read(f.ledger), f.before);
    assert.equal(fs.readdirSync(f.root).some(name => name.endsWith('.tmp')), false);
  });
}
