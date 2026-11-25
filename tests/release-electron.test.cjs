// 此文件既是Node专项测试入口，也是独立Electron探针；不加载正式应用与数据目录。
if (process.versions.electron && process.argv.includes('--release-ed25519-probe')) {
  const {app} = require('electron');
  const crypto = require('node:crypto');
  const profile = process.argv.find(value => value.startsWith('--release-probe-profile='))?.slice('--release-probe-profile='.length);
  app.disableHardwareAcceleration();
  app.setName('超级IP发行验签探针');
  app.setPath('userData', profile);
  app.whenReady().then(() => {
    const pair = crypto.generateKeyPairSync('ed25519'), message = Buffer.from('超级IP SIP1 Electron 验签专项');
    const signature = crypto.sign(null, message, pair.privateKey);
    const verify = crypto.verify(null, message, pair.publicKey, signature);
    const tampered = crypto.verify(null, Buffer.concat([message, Buffer.from('篡改')]), pair.publicKey, signature);
    console.log('RELEASE_ED25519=' + JSON.stringify({electron: process.versions.electron, node: process.versions.node, signatureBytes: signature.length, publicDerBytes: pair.publicKey.export({type: 'spki', format: 'der'}).length, verify, tampered}));
    app.exit(verify && !tampered ? 0 : 1);
  }).catch(() => app.exit(1));
} else {
  const {test} = require('node:test');
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const {spawn} = require('node:child_process');
  test('真实Electron运行时Ed25519可签可验且拒绝篡改，使用独立临时profile', async t => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sip-release-electron-'));
    t.after(() => fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100}));
    const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
    const result = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [__filename, '--release-ed25519-probe', '--release-probe-profile=' + profile], {env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
      let stdout = '', stderr = '';
      const timeout = setTimeout(() => { child.kill(); reject(Error('独立Electron验签探针超时')); }, 30000);
      child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('close', code => { clearTimeout(timeout); resolve({code, stdout, stderr}); });
    });
    assert.equal(result.code, 0, 'Electron退出异常：' + result.stderr);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('RELEASE_ED25519=')); assert(line, '未收到真实Electron验签收据');
    const receipt = JSON.parse(line.slice('RELEASE_ED25519='.length));
    assert.equal(receipt.electron, require('../package.json').devDependencies.electron);
    assert.equal(receipt.signatureBytes, 64); assert.equal(receipt.publicDerBytes, 44); assert.equal(receipt.verify, true); assert.equal(receipt.tampered, false);
    t.diagnostic(JSON.stringify({...receipt, exitCode: result.code}));
  });
}
