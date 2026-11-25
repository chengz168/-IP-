const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createService } = require('./support/licensed-service.cjs');
const { validateShots, form, signature } = require('../server/product-studio.cjs');
const { hash } = require('../server/story-contract.cjs');
const { speechContext, speechRequest, speechEvidence } = require('../server/speech-request.cjs');

// 仅验证工作流契约：文本服务、图片探测和视频渲染使用明确注入的测试替身。
// 所有资料都位于临时目录，不读取用户数据，也不将这些测试当成真实模型与媒体验收。
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'product-studio-'));
  const oldListeners = new Set(process.listeners('exit'));
  const service = createService(dir, undefined, { manageLocalEnvironment: false });
  const listeners = process.listeners('exit').filter(item => !oldListeners.has(item));
  t.after(() => {
    for (const listener of listeners) process.removeListener('exit', listener);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const d = service.store.draft();
  d.product = { url: '', sourceRunId: '', title: '测试商品', description: '商品材质为PP', brand: '', sku: '', price: '', currency: '', specifications: [], selectedIndices: [], assetIds: [], duration: 15, aspect: '9:16', brief: '', scriptRunId: '', shots: [], narration: false };
  service.media.probe = async () => ({ streams: [{ codec_type: 'video', width: 750, height: 750 }] });
  service.providers.config = () => ({});
  const file = path.join(dir, 'image.png');
  fs.writeFileSync(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=', 'base64'));
  const asset = service.store.addAsset(file);
  d.product.assetIds = [asset.id];
  service.providers.text = async () => ({ text: JSON.stringify({ shots: [
    { text: '了解这款测试商品', visual: '完整展示商品原图', action:'商品沿原位置小幅转动后停下',camera:'中景固定机位', imageIndex: 0, duration: 5 },
    { text: '查看商品详情中的材质信息', visual: '展示详情原图', action:'商品局部随光线变化显露纹理',camera:'近景固定机位', imageIndex: 0, duration: 5 },
    { text: '选择前请核对商品规格', visual: '回到商品主图', action:'商品轻微转动回到正面',camera:'中景固定机位', imageIndex: 0, duration: 5 },
  ] }) });
  return { service, id: d.id, asset };
}
async function scriptFixture(t) {
  const env = fixture(t);
  const output = await env.service.invoke('createProductScript', { id: env.id });
  const d = env.service.store.draft(env.id);
  d.product.scriptRunId = output.runId;
  d.product.shots = structuredClone(output.shots);
  return { ...env, output };
}
function confirm(service, id, text) {
  const d = service.store.draft(id);
  Object.assign(d, { sourceText: text, rewrite: text, finalText: text, confirmed: true });
}

test('商品后台读取失败保留可见页面凭据和错误码，原脚本不被服务端改写',async t=>{
 const {service,id}=fixture(t),before=structuredClone(service.store.draft(id).product);
 const evidence={productPage:{code:'PRODUCT_PAGE_RESTRICTED',visibleText:'检测到当前环境存在安全风险',imageCount:0}};
 service.products.pageReader={read:async()=>{throw Object.assign(Error('软件本次后台页面显示安全风险。'),{code:'PRODUCT_PAGE_RESTRICTED',evidence});}};
 await assert.rejects(service.invoke('collectProduct',{id,url:'https://localhost/item'}),error=>error.code==='PRODUCT_PAGE_RESTRICTED'&&!error.message.includes('。。'));
 assert.deepEqual(service.store.draft(id).product,before);const run=service.store.data.runs[0];assert.equal(run.status,'failed');assert.deepEqual(run.failureOutput,evidence);
});
function audioAsset(service, id, request) {
  const file = path.join(service.store.root, 'third-step.wav');
  fs.writeFileSync(file, '音频契约测试占位，未调用真实模型');
  const asset = service.store.addAsset(file, { speech: { request } });
  service.store.draft(id).voice.audioId = asset.id;
  return asset;
}
function videoRecord(service, id) {
  const d = service.store.draft(id);
  const file = path.join(service.store.root, 'clip.mp4');
  fs.writeFileSync(file, '视频契约测试占位，未调用真实渲染');
  const asset = service.store.addAsset(file);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(asset.path)).digest('hex');
  const output = { asset, baseAsset: asset, audioId: '', shots: structuredClone(d.product.shots), captions: [{ start: 0, end: 5, text: d.finalText }], inputSignature: signature(d), voiceInputSignature: hash({ provider: {}, language: d.language, voice: { ...d.voice, audioId: undefined } }), confirmedTextHash: hash(d.finalText), outputSha256: digest, baseSha256: digest, scriptRunId: d.product.scriptRunId };
  service.store.data.runs.push({ id: 'video-run', draftId: id, type: 'product-video', status: 'succeeded', output });
  return output;
}

test('表单与镜头拒绝非法时长、画幅、规格及任意图片绑定', () => {
  const images = [{ id: 'in' }];
  assert.throws(() => validateShots([{ text: '内容', imageId: 'outside', duration: 3 }], images), /绑定/);
  for (const duration of [NaN, Infinity, 0, 61]) assert.throws(() => validateShots([{ text: '内容', imageId: 'in', duration }], images), /时长/);
  assert.throws(() => validateShots([], images), /镜头/);
  assert.throws(() => form({ product: { title: '商品', duration: 0, aspect: '9:16' } }), /时长/);
  assert.throws(() => form({ product: { title: '商品', duration: 15, aspect: '2:1' } }), /画幅/);
  assert.throws(() => form({ product: { title: '商品', duration: 15, aspect: '9:16', specifications: [{ name: '', value: 'PP' }] } }), /规格名/);
});
test('手工图片结合注入文本服务生成脚本，留证据且不覆盖旧文案', async t => {
  const { service, id } = fixture(t);
  service.store.draft(id).sourceText = '用户旧稿';
  const output = await service.invoke('createProductScript', { id });
  assert.ok(output.runId);
  assert.equal(output.stale, false);
  assert.equal(output.shots.length, 3);
  assert.equal(output.shots.reduce((total, shot) => total + shot.duration, 0), 15);
  assert.equal(service.store.draft(id).sourceText, '用户旧稿');
  assert.equal(output.visual.status, 'unconfigured');
  assert.ok(output.evidence.system.includes('不得虚构'));
  assert.equal(service.store.data.runs[0].status, 'succeeded');
});
test('生成期间改资料使脚本过期，不能附着到当前稿', async t => {
  const { service, id } = fixture(t);
  const original = service.providers.text;
  service.providers.text = async (...args) => {
    const value = await original(...args);
    service.store.draft(id).product.title = '用户刚修改商品';
    return value;
  };
  const output = await service.products.create({ id });
  assert.equal(output.stale, true);
  assert.throws(() => service.products.report(id, output.runId, 'product-script'), /失效/);
});
test('选用商品脚本进入第二步待确认，保留商品模式与原图绑定', async t => {
  const { service, id, asset, output } = await scriptFixture(t);
  confirm(service, id, '原先已确认的旧稿');
  const saved = await service.invoke('useProductScript', { id, runId: output.runId });
  assert.equal(saved.step, 1);
  assert.equal(saved.confirmed, false);
  assert.equal(saved.finalText, '');
  assert.equal(saved.sourceText, output.text);
  assert.equal(saved.rewrite, output.text);
  assert.equal(saved.video.mode, 'product');
  assert.equal(saved.product.scriptRunId, output.runId);
  assert.equal(saved.story.episodes.length, 1);
  assert.equal(saved.story.episodes[0].shots.length, 3);
  assert.ok(saved.product.shots.every(shot => shot.imageId === asset.id));
  assert.equal(saved.story.assets[0].selectedImageId, asset.id);
});
test('同步镜头逐字保留确认稿与原图绑定，不重新生成台词', async t => {
  const { service, id, output } = await scriptFixture(t);
  await service.invoke('useProductScript', { id, runId: output.runId });
  const exactText = '  看看这款商品。\n材质为 PP！\n\n购买前，先核对规格。  ';
  confirm(service, id, exactText);
  const before = structuredClone(service.store.draft(id));
  const saved = await service.invoke('syncProductShots', { id });
  assert.equal(saved.finalText, exactText);
  assert.equal(saved.confirmed, true);
  assert.equal(saved.product.shots.map(shot => shot.text).join(''), exactText);
  assert.deepEqual(saved.product.shots.map(shot => shot.imageId), before.product.shots.map(shot => shot.imageId));
  assert.deepEqual(saved.product.shots.map(shot => shot.visual), before.product.shots.map(shot => shot.visual));
  assert.equal(saved.product.scriptRunId, output.runId);
});
test('未确认文案或镜头未同步时禁止跳过第二步生成视频', async t => {
  const { service, id, output } = await scriptFixture(t);
  await service.invoke('useProductScript', { id, runId: output.runId });
  await assert.rejects(service.invoke('syncProductShots', { id }), /确认文案/);
  await assert.rejects(service.products.generate({ id }), /第二步确认/);
  confirm(service, id, '用户修改后、还没有同步到镜头的正文。');
  await assert.rejects(service.products.generate({ id }), /同步/);
  assert.equal(service.store.data.runs.filter(run => run.type === 'product-video').length, 0);
});
test('商品资料或图片文件改变后拒绝旧脚本，不覆盖现有草稿', async t => {
  const { service, id, asset, output } = await scriptFixture(t);
  const d = service.store.draft(id);
  d.product.title = '另一件商品';
  await assert.rejects(service.products.generate({ id }), /改变/);
  d.product.title = '测试商品';
  fs.appendFileSync(asset.path, '内容变更');
  const before = structuredClone(d);
  await assert.rejects(service.products.useScript({ id, runId: output.runId }), /商品图已变化/);
  assert.deepEqual(service.store.draft(id), before);
});
test('开启旁白必须使用第三步配音，缺少音频时不启动视频任务', async t => {
  const { service, id } = fixture(t);
  service.store.draft(id).product.narration = true;
  const output = await service.products.create({ id });
  const d = service.store.draft(id);
  d.product.scriptRunId = output.runId;
  d.product.shots = structuredClone(output.shots);
  confirm(service, id, output.text);
  await assert.rejects(service.products.generate({ id }), /声音|音频|文件不存在/);
  assert.equal(service.store.data.runs.filter(run => run.type === 'product-video').length, 0);
});
test('旧文案或旧声音参数的配音不能复用于当前商品视频', async t => {
  const { service, id } = fixture(t);
  service.store.draft(id).product.narration = true;
  const output = await service.products.create({ id });
  const d = service.store.draft(id);
  d.product.scriptRunId = output.runId;
  d.product.shots = structuredClone(output.shots);
  confirm(service, id, output.text);
  const request = speechRequest(d, speechContext(service.store.data));
  const audio = audioAsset(service, id, speechEvidence({ ...request, text: '这是另一份旧稿' }));
  await assert.rejects(service.products.generate({ id }), /配音.*不一致|第三步重新生成/);
  audio.speech.request = speechEvidence(request);
  d.voice.speed = 1.2;
  await assert.rejects(service.products.generate({ id }), /配音.*不一致|第三步重新生成/);
});
test('当前配音证据传给渲染器，生成期间取消不会选用产物', async t => {
  const { service, id } = fixture(t);
  service.store.draft(id).product.narration = true;
  const output = await service.products.create({ id });
  const d = service.store.draft(id);
  d.product.scriptRunId = output.runId;
  d.product.shots = structuredClone(output.shots);
  confirm(service, id, output.text);
  const audio = audioAsset(service, id, speechEvidence(speechRequest(d, speechContext(service.store.data))));
  const before = structuredClone(d);
  let called = false;
  t.mock.method(require('../server/product-video.cjs'), 'renderProductVideo', async (_service, input, ctx) => {
    called = true;
    assert.equal(input.audioId, audio.id);
    const run = service.store.data.runs.find(row => row.type === 'product-video');
    service.runtime.cancel(run.id);
    ctx.signal.throwIfAborted();
  });
  await assert.rejects(service.products.generate({ id }));
  assert.equal(called, true);
  assert.equal(service.store.data.runs.find(run => run.type === 'product-video').status, 'cancelled');
  assert.deepEqual(service.store.draft(id), before);
});
test('选用视频要求确认正文哈希，缺失或过期不能覆盖草稿', async t => {
  const { service, id, output } = await scriptFixture(t);
  confirm(service, id, output.text);
  const rendered = videoRecord(service, id);
  const before = structuredClone(service.store.draft(id));
  delete rendered.confirmedTextHash;
  await assert.rejects(service.products.use({ id, runId: 'video-run' }), /确认文案|变化/);
  assert.deepEqual(service.store.draft(id), before);
  rendered.confirmedTextHash = hash('旧稿');
  await assert.rejects(service.products.use({ id, runId: 'video-run' }), /确认文案|变化/);
  assert.deepEqual(service.store.draft(id), before);
});
test('生成视频后切换语言禁止选用旧成片且保留原稿', async t => {
  const { service, id, output } = await scriptFixture(t);
  confirm(service, id, output.text);
  videoRecord(service, id);
  service.store.draft(id).language = '英语';
  const before = structuredClone(service.store.draft(id));
  await assert.rejects(service.products.use({ id, runId: 'video-run' }), /配音|变化/);
  assert.deepEqual(service.store.draft(id), before);
});

test('当前资料、配音及确认稿的视频可选用到第五步，保留原素材', async t => {
  const { service, id, asset, output } = await scriptFixture(t);
  confirm(service, id, output.text);
  const rendered = videoRecord(service, id);
  const d = service.store.draft(id);
  d.voice.speed = 1.1;
  await assert.rejects(service.products.use({ id, runId: 'video-run' }), /配音|变化/);
  d.voice.speed = 1;
  const saved = await service.invoke('useProductVideo', { id, runId: 'video-run' });
  assert.equal(saved.step, 4);
  assert.equal(saved.edit.resultId, rendered.asset.id);
  assert.equal(saved.confirmed, true);
  assert.equal(saved.finalText, output.text);
  assert.equal(service.store.asset(asset.id).id, asset.id);
});
test('选用脚本保存失败恢复原稿，不丢已有确认正文', async t => {
  const { service, id, output } = await scriptFixture(t);
  confirm(service, id, '现有确认稿');
  const before = structuredClone(service.store.draft(id));
  service.store.save = () => { throw Error('磁盘写入失败'); };
  await assert.rejects(service.products.useScript({ id, runId: output.runId }), /磁盘/);
  assert.deepEqual(service.store.draft(id), before);
});

for (const [label, mutate] of [
  ['商品镜头', next => { next.product.shots[0].visual += '，修改展示方式'; }],
  ['确认文案', next => { next.finalText += '补充新的注意事项。'; }],
  ['上游配音', (next, replacementAudio) => { next.voice.audioId = replacementAudio.id; }],
  ['文案语言', next => { next.language = '英语'; }],
]) {
  test('选用商品视频后修改' + label + '撤销旧交接且保留素材文件', async t => {
    const { service, id, asset, output } = await scriptFixture(t);
    confirm(service, id, output.text);
    const rendered = videoRecord(service, id);
    const selected = await service.invoke('useProductVideo', { id, runId: 'video-run' });
    assert.equal(selected.productSelection.baseId, rendered.baseAsset.id);
    assert.equal(selected.edit.sourceId, rendered.baseAsset.id);
    assert.equal(selected.edit.resultId, rendered.asset.id);
    const beforeImage = fs.readFileSync(asset.path);
    const beforeVideo = fs.readFileSync(rendered.asset.path);
    const replacementFile = path.join(service.store.root, 'replacement.wav');
    fs.writeFileSync(replacementFile, '新的上游配音契约占位');
    const replacementAudio = service.store.addAsset(replacementFile);
    const next = structuredClone(service.store.draft(id));
    mutate(next, replacementAudio);
    const saved = service.store.updateDraft(next);
    assert.equal(saved.edit.sourceId, '');
    assert.equal(saved.edit.resultId, '');
    assert.equal(saved.video.assetId, '');
    assert.equal(saved.productSelection, undefined);
    assert.deepEqual(fs.readFileSync(service.store.asset(asset.id).path), beforeImage);
    assert.deepEqual(fs.readFileSync(service.store.asset(rendered.asset.id).path), beforeVideo);
    assert.ok(fs.existsSync(service.store.asset(replacementAudio.id).path));
  });
}

test('选用商品视频后正常切换步骤保留成片交接，不清空剪辑源', async t => {
  const { service, id, output } = await scriptFixture(t);
  confirm(service, id, output.text);
  const rendered = videoRecord(service, id);
  const selected = await service.invoke('useProductVideo', { id, runId: 'video-run' });
  for (const step of [1, 2, 3, 4, 5, 6]) {
    const next = structuredClone(service.store.draft(id));
    next.step = step;
    const saved = service.store.updateDraft(next);
    assert.equal(saved.step, step);
    assert.equal(saved.confirmed, true);
    assert.equal(saved.finalText, selected.finalText);
    assert.equal(saved.video.mode, 'product');
    assert.equal(saved.video.assetId, rendered.baseAsset.id);
    assert.equal(saved.edit.sourceId, rendered.baseAsset.id);
    assert.equal(saved.edit.resultId, rendered.asset.id);
    assert.deepEqual(saved.productSelection, selected.productSelection);
  }
});

test('商品模式未生成视频时自动流程给出商品步骤提示，不要求数字人形象', t => {
  const { service, id } = fixture(t);
  const d = service.store.draft(id);
  d.video.mode = 'product';
  assert.equal(d.video.avatarId, '');
  assert.equal(service.store.data.avatars.length, 0);
  const plan = service.workflows.plan(id);
  assert.equal(plan.draftId, id);
  assert.deepEqual(plan.stages, []);
  assert.equal(plan.issues.length, 1);
  assert.match(plan.issues[0], /第四步商品宣传.*生成并选用商品视频/);
  assert.doesNotMatch(plan.issues.join(''), /数字人|口型|配音服务|形象视频/);
});


test('商品脚本明确质量问题只纠正一次，采用实际纠正响应并保留请求证据', async t=>{
 const {service,id}=fixture(t),valid=JSON.parse((await service.providers.text()).text),bad=structuredClone(valid),requests=[];
 for(const shot of bad.shots)shot.action='无主体动作变化，仅展示静止外观';
 service.providers.text=async(system,user)=>{requests.push({system,user});return {text:JSON.stringify(requests.length===1?bad:valid)};};
 const result=await service.invoke('createProductScript',{id});
 assert.equal(requests.length,2);assert.match(requests[1].user,/全部镜头缺少主体动作/);assert.equal(result.evidence.attempts.length,2);
 assert.equal(result.shots[0].action,valid.shots[0].action);assert.equal(result.qualityAccepted,false);
});
test('商品纠正后仍全静态时拒绝，旧脚本与媒体不改，失败记录保留两次响应', async t=>{
 const {service,id}=fixture(t),bad=JSON.parse((await service.providers.text()).text),d=service.store.draft(id);
 d.product.shots=[{text:'原脚本'}];d.voice.audioId='保留声音';d.video.assetId='保留视频';const before=structuredClone(d);
 for(const shot of bad.shots)shot.action='无主体动作变化，仅展示静止外观';let calls=0;
 service.providers.text=async()=>{calls++;return {text:JSON.stringify(bad)};};
 await assert.rejects(service.invoke('createProductScript',{id}),/商品脚本未通过检查.*旧脚本保留/);
 assert.equal(calls,2);assert.deepEqual(service.store.draft(id),before);
 const run=service.store.data.runs[0];assert.equal(run.status,'failed');assert.equal(run.failureOutput.attempts.length,2);assert.equal(run.failureOutput.qualityAccepted,false);
});
