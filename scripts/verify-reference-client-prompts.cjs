const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const parser = require('@babel/parser');
const root = path.resolve('evidence/reference/generation-hints-20261115');
const report = JSON.parse(fs.readFileSync(path.join(root, 'prompt-functions.json'), 'utf8'));
const sourceAst = name => parser.parse('const fragment = ' + report.fragments.find(item => item.name === name).code + ';');
function walk(node, visit) {
 if (!node || typeof node !== 'object') return;
 if (node.type) visit(node);
 for (const [key, value] of Object.entries(node)) {
  if (['loc', 'start', 'end', 'extra'].includes(key)) continue;
  if (Array.isArray(value)) value.forEach(item => walk(item, visit));
  else if (value && typeof value === 'object') walk(value, visit);
 }
}
// 仅对原代码的字符串拼接表达式做白名单静态求值，禁止eval、网络、任意函数调用。
function literal(node, env) {
 if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(node.type)) return node.value;
 if (node.type === 'Identifier' && Object.hasOwn(env, node.name)) return env[node.name];
 if (node.type === 'MemberExpression') return literal(node.object, env)[node.computed ? literal(node.property, env) : node.property.name];
 if (node.type === 'BinaryExpression' && node.operator === '+') return literal(node.left, env) + literal(node.right, env);
 if (node.type === 'LogicalExpression' && node.operator === '||') return literal(node.left, env) || literal(node.right, env);
 if (node.type === 'ConditionalExpression') return literal(node.test, env) ? literal(node.consequent, env) : literal(node.alternate, env);
 if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === '_0x5e5eae') return String(literal(node.arguments[0], env) || '').trim();
 if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && (node.callee.property.value || node.callee.property.name) === 'trim' && node.arguments.length === 0) return String(literal(node.callee.object, env)).trim();
 throw Error('拒绝非白名单表达式：' + node.type);
}
function initializer(name, variable, env) {
 let expression;
 walk(sourceAst(name), node => {if (node.type === 'VariableDeclarator' && node.id.name === variable) expression = node.init;});
 assert.ok(expression, variable); return literal(expression, env);
}
function strings(name) {const result = []; walk(sourceAst(name), node => {if (node.type === 'StringLiteral') result.push(node.value);}); return result;}
(async () => {
 const api = await import('../server/reference-client-prompts.mjs');
 const helper = parser.parse(fs.readFileSync('evidence/validation/custom-title-native/reference/969.7384c488.js.readable.cjs', 'utf8'));
 let constraints;
 walk(helper, node => {if (node.type === 'ArrayExpression' && node.elements[0]?.value === '【输出格式强约束】') constraints = node.elements.map(item => {assert.equal(item.type, 'StringLiteral'); return item.value;}).join('\n');});
 assert.equal(api.referenceOutputConstraints, constraints);
 const checks = [];
 for (const filled of [false, true]) {
  const fields = {keyword: '  收纳  ', persona: filled ? '  经验型IP ' : '', customPersona: filled ? ' 整理师 ' : '', targetAudience: filled ? ' 租房青年 ' : ''};
  const env = {_0x477604: fields, _0x4a0de9: 5, _0x1aeb26: {title: '整理前先做什么', personaAngle: '实际经验'}, _0x12696f: 200};
  const keywordCore = initializer('keyword-topics', '_0x109360', env);
  const schema = strings('keyword-topics').find(text => text.startsWith('\n\nJSON 格式：'));
  const input = {keyword: fields.keyword, persona: fields.persona, customPersona: fields.customPersona, audience: fields.targetAudience};
  assert.equal(api.referenceKeywordTopicsPrompt(input), keywordCore + schema);
  const topicCore = initializer('topic-copy', '_0x5cfb55', env);
  assert.equal(api.referenceTopicCopyPrompt({...input, title: env._0x1aeb26.title, personaAngle: env._0x1aeb26.personaAngle, wordLimit: 200}), topicCore + '\n\n' + constraints + '\n');
  checks.push({kind: 'keyword-topics', filled, exactStaticExpression: true}, {kind: 'topic-copy', filled, exactStaticExpression: true});
 }
 for (const filled of [false, true]) {
  const fields = {productName: filled ? 'L7台灯' : '', sellingPoints: filled ? 'USB供电' : '', targetAudience: '', promotions: '', persona: ''};
  const template = filled ? '口语表达' : '', limit = filled ? 100 : 0;
  const env = {_0x4adbbb: fields, _0x53d852: template, _0x5933b3: limit ? `【字数限制要求：请严格将改写后的文案控制在 ${limit} 字左右。\n\n` : ''};
  const core = initializer('marketing', '_0x2592c3', env);
  assert.equal(api.referenceMarketingPrompt({name: fields.productName, selling: fields.sellingPoints, template, wordLimit: limit}), core + '\n\n' + constraints + '\n');
  let rewriteExpression;
  walk(sourceAst('rewrite-call'), node => {if (node.type === 'AssignmentExpression' && node.left.name === '_0x42e8ed' && node.right.type === 'ConditionalExpression') rewriteExpression = node.right;});
  const rewriteEnv = {_0x2e3200: filled ? {content: template} : null, _0x4bc631: limit ? `【字数限制要求：请忽略以下用户附加要求中可能存在的字数要求的部分，严格遵循 ${limit} 字进行文案输出。】\n\n` : '', _0x14c5d6: '先摆好台灯。'};
  assert.equal(api.referenceRewritePrompt({text: rewriteEnv._0x14c5d6, template, wordLimit: limit}), literal(rewriteExpression, rewriteEnv) + '\n\n' + constraints + '\n');
  checks.push({kind: 'marketing', filled, exactStaticExpression: true}, {kind: 'rewrite', filled, exactStaticExpression: true});
 }
 assert.equal(api.withReferenceOutputConstraints('正文\n' + constraints), '正文\n' + constraints);
 const output = {checkedAt: new Date().toISOString(), checks, outputConstraintsExact: true, referenceCodeExecuted: false, serverInternalKnown: false, modelRequests: 0};
 fs.writeFileSync(path.join(root, 'builder-verification.json'), JSON.stringify(output, null, 2)); console.log(JSON.stringify(output));
})().catch(error => {console.error(error); process.exitCode = 1;});
