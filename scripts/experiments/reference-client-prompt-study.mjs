import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {referenceRewritePrompt, referenceClientSource} from '../../server/reference-client-prompts.mjs';
import {Providers} from '../../server/providers.cjs';

// 使用已有本机服务做独立实验，不更换用户配置或写入用户任务。
const root = path.resolve('evidence/research/generation-chain-20261115/prompt-experiment');
fs.mkdirSync(root, {recursive: true});
const data = JSON.parse(fs.readFileSync('evidence/validation/pip-desktop-workspace/studio.json', 'utf8'));
const provider = structuredClone(data.settings.provider);
if (provider.textProtocol !== 'ollama' || !['127.0.0.1', 'localhost'].includes(new URL(provider.baseUrl).hostname)) throw Error('本实验仅允许已有本机Ollama服务');
const providers = new Providers({data: {settings: {provider}}}, null, {get: async () => ''});
const template = fs.readFileSync('evidence/reference/prompt-audit/copy-default.txt', 'utf8').replace(/\r\n/g, '\n');
const samples = [
 {id: 'product', text: '先把台灯放在桌面左侧。确认桌边有可用电源，再把USB线插好。L7台灯底座宽12厘米，不能直接接触水。用完后先断电，再用干布擦拭底座。'},
 {id: 'notice', text: '周六下午来换书。每人最多带5本书，教材和破损书不参与交换。先到入口登记，再把书放到对应分类的桌上。活动结束前，把没有换出去的书带走。'},
];
const receipt = {startedAt: new Date().toISOString(), model: provider.model, source: referenceClientSource, productionChanged: false, runs: [], qualityAccepted: false, referenceParityAccepted: false};
for (const sample of samples) {
 const prompt = referenceRewritePrompt({text: sample.text, template, wordLimit: sample.text.length});
 const run = {id: sample.id, source: sample.text, targetCharacters: sample.text.length, prompt, promptSha256: crypto.createHash('sha256').update(prompt).digest('hex'), system: '', startedAt: new Date().toISOString()};
 receipt.runs.push(run);
 try {
  const result = await providers.text('', prompt, {}, {model: provider.model, temperature: 0});
  Object.assign(run, {succeeded: true, result, outputCharacters: result.text.length, humanSemanticReview: null});
 } catch (error) {Object.assign(run, {succeeded: false, error: error.message});}
 run.finishedAt = new Date().toISOString();
 fs.writeFileSync(path.join(root, 'receipt.json'), JSON.stringify(receipt, null, 2));
 console.log(JSON.stringify({id: run.id, succeeded: run.succeeded, text: run.result?.text, error: run.error}));
}
receipt.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(root, 'receipt.json'), JSON.stringify(receipt, null, 2));
