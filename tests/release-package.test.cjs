const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {Minimatch} = require('minimatch');
const pkg = require('../package.json');

test('发行配置由已安装electron-builder真实schema校验，无需执行打包', async () => {
  const {validateConfiguration} = require('app-builder-lib/out/util/config/config.js');
  await validateConfiguration(pkg.build, {isEnabled: false});
});

test('发行保持应用身份和原生资源，启用NSIS/dir与交互安装选项', () => {
  assert.equal(pkg.version, '0.1.1'); assert.equal(pkg.build.appId, 'local.superip.studio'); assert.equal(pkg.build.productName, '超级IP智能体');
  assert.deepEqual(pkg.build.win.target, ['nsis', 'dir']);
  assert.deepEqual(pkg.build.nsis, {oneClick: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true});
  for (const entry of ['server/local-asr.py', 'server/local-indextts.py', 'integrations/indextts-local/**/*', 'integrations/musetalk-local/**/*', 'integrations/local-link-extractor/**/*', 'integrations/qwen-voice-design/**/*', 'integrations/portrait-matting/**/*']) assert(pkg.build.asarUnpack.includes(entry), entry);
  assert.equal(pkg.build.win.signAndEditExecutable, undefined); assert.equal(pkg.build.win.signExecutable, false);
  assert.equal(pkg.build.asar, undefined); assert.notEqual(pkg.build.disableAsarIntegrity, true);
});

test('五个发行fuse使用对象配置，保留file协议与账号Cookie的默认行为', () => {
  const fuses = pkg.build.electronFuses;
  assert(!Array.isArray(fuses));
  assert.deepEqual(fuses, {runAsNode: false, enableNodeOptionsEnvironmentVariable: false, enableNodeCliInspectArguments: false, onlyLoadAppFromAsar: true, enableEmbeddedAsarIntegrityValidation: true});
  assert.equal(fuses.grantFileProtocolExtraPrivileges, undefined); assert.equal(fuses.enableCookieEncryption, undefined);
  // 关闭RunAsNode前仅扫描会打包的JS源码；测试/开发工具不作为发行运行依赖。
  function scan(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (/\.(?:cjs|mjs|js)$/.test(entry.name)) assert(!/\bfork\s*\(/.test(fs.readFileSync(file, 'utf8')), '发行源码新增fork时需重新评估RunAsNode：' + file);
    }
  }
  for (const dir of ['electron', 'server', 'integrations']) scan(path.join(__dirname, '..', dir));
});

test('发行白名单包含客户端公钥，排除出码工具与私钥类文件', () => {
  const patterns = pkg.build.files;
  assert(patterns.every(value => typeof value === 'string'));
  const included = file => patterns.filter(value => !value.startsWith('!')).some(value => new Minimatch(value, {dot: true}).match(file)) && !patterns.filter(value => value.startsWith('!')).some(value => new Minimatch(value.slice(1), {dot: true}).match(file));
  assert(included('server/license-public-key.cjs')); assert(included('electron/main.cjs'));
  for (const file of ['scripts/make-license.cjs', 'scripts/.license-private.pem', 'server/accidental.pem', 'electron/accidental.key', 'server/certificate.pfx', 'integrations/indextts-local/secret.p12']) assert.equal(included(file), false, file);
  const value = require('../server/license-public-key.cjs');
  assert.equal(typeof value, 'string'); const bytes = Buffer.from(value, 'base64'); assert.equal(bytes.length, 44);
  assert.equal(crypto.createPublicKey({key: bytes, type: 'spki', format: 'der'}).asymmetricKeyType, 'ed25519');
});

test('发行pack命令先检查干净源码，再构建并生成两个目标', () => {
  assert.equal(pkg.scripts.pack, 'node scripts/make-license.cjs --check-release && npm run build && electron-builder --win nsis dir');
});
