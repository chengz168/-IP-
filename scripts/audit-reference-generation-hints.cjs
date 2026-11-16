const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const asar = require('@electron/asar');
const parser = require('@babel/parser');
const archive = 'F:/Software/轻语IP智能体/aigc-human/resources/app.asar';
const root = path.resolve('evidence/reference/generation-hints-20261115');
fs.mkdirSync(root, {recursive: true});
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const files = asar.listPackage(archive).filter(file => /\.js$/.test(file) && !file.includes('node_modules') && !file.includes('chunk-vendors'));
const report = {checkedAt: new Date().toISOString(), method: '只读AST静态字符串提取；未执行原厂代码', files: [], hints: [], instructionCandidates: [], failures: [], completeCloudRequestObtained: false};
const namedModelPattern = /index.?tts|cosy.?voice|gpt.?sovits|muse.?talk|latent.?sync|wav2lip|f5.?tts|fish.?speech|sadtalker|\bhallo\b|echomimic|ultralight/i;
const modelPattern = /index.?tts|cosy.?voice|gpt.?sovits|muse.?talk|latent.?sync|wav2lip|f5.?tts|fish.?speech|sadtalker|\bhallo\b|echomimic|ultralight|whisper|hubert|s3tokenizer|qwen|deepseek|emotion_weight|emotion_text|prompt_text|prompt_audio|generateDigitalHuman|soundClone/i;
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (node.type) visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(item => walk(item, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}
for (const file of files) {
  const code = asar.extractFile(archive, file.replace(/^[\\/]/, '')).toString('utf8');
  report.files.push({file, bytes: Buffer.byteLength(code), sha256: sha(code)});
  try {
    walk(parser.parse(code, {sourceType: 'unambiguous'}), node => {
      if (!['StringLiteral', 'TemplateElement'].includes(node.type)) return;
      const text = node.type === 'StringLiteral' ? node.value : node.value.cooked || node.value.raw;
      // 排除URL和可能承载认证信息的文本；模型名称出现只算线索，不能认定真实服务。
      if (/https?:|Bearer\s|api[_-]?key\s*[:=]|access[_-]?token\s*[:=]/i.test(text)) return;
      if (text.length > 35 && text.length <= 4500 && /你是|只输出|严格|请根据|写作要求|待翻译|选择.{0,15}音乐|语义.{0,15}匹配/.test(text)) report.instructionCandidates.push({file, start: node.start, end: node.end, sha256: sha(text), text, completeRequest: false});
      if (modelPattern.test(text) && text.length <= 4500) report.hints.push({file, start: node.start, end: node.end, sha256: sha(text), text, runtimeVerified: false});
    });
  } catch (error) {report.failures.push({file, error: error.message});}
}
fs.writeFileSync(path.join(root, 'static-hints.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({scanned: report.files.length, failures: report.failures, hints: report.hints.length, modelNames: [...new Set(report.hints.filter(item => namedModelPattern.test(item.text)).map(item => item.text))]}, null, 2));
