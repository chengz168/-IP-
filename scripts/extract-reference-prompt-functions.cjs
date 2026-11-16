const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const parser = require('@babel/parser');
const {transformSync} = require('esbuild');
const root = path.resolve('evidence/reference/generation-hints-20261115');
const decodedFile = path.resolve('evidence/validation/edit-overlays/reference-decoded.js');
// 使用已有的独立校验脚本重新生成静态解码结果；不加载或执行原厂模块。
cp.execFileSync(process.execPath, ['evidence/audit-reference-edit-overlays.cjs'], {stdio: 'pipe'});
const source = fs.readFileSync(decodedFile, 'utf8');
const evidence = JSON.parse(fs.readFileSync('evidence/validation/edit-overlays/reference-fragments.json', 'utf8'));
const matches = [];
function walk(node, ancestors = []) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'StringLiteral' && /你是短视频爆款选题|你是一个专业的短视频口播|根据以上信息进行创作，并以纯 JSON|【字数限制要求/.test(node.value)) {
    const fn = ancestors.findLast(item => ['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(item.type));
    if (fn && fn.end - fn.start < 18000 && !matches.some(item => item.start === fn.start)) matches.push({start: fn.start, end: fn.end, code: source.slice(fn.start, fn.end)});
  }
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'start', 'end', 'extra'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach(item => walk(item, [...ancestors, node]));
    else if (value && typeof value === 'object') walk(value, [...ancestors, node]);
  }
}
walk(parser.parse(source));
const names = ['marketing', 'brain-topics', 'keyword-topics', 'topic-copy', 'rewrite-call'];
for (let i = 0; i < matches.length; i++) {
  const item = matches[i];
  item.name = names[i];
  item.file = 'prompt-function-' + item.name + '.txt';
  const readable = transformSync('const fragment = ' + item.code + ';', {loader: 'js', charset: 'utf8', minify: false}).code;
  fs.writeFileSync(path.join(root, item.file), readable);
  item.sha256 = crypto.createHash('sha256').update(item.code).digest('hex');
}
const alias = source.indexOf('_0xb65ce6=');
const report = {
  checkedAt: new Date().toISOString(), originalSource: evidence.sourcePath, originalSha256: evidence.sourceSha256,
  decodedFile, decodedSha256: crypto.createHash('sha256').update(source).digest('hex'),
  verification: '独立数值校验及AST提取；未执行原厂函数',
  fragments: matches, languageHelperImport: source.slice(alias - 40, alias + 100),
  serverInternalPromptKnown: false, originalCloudRequestsSent: 0,
};
fs.writeFileSync(path.join(root, 'prompt-functions.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({sourceSha256: report.originalSha256, fragments: matches.map(({name, file, start, end, sha256}) => ({name, file, start, end, sha256})), languageHelperImport: report.languageHelperImport}));
