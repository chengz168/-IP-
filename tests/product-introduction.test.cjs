const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createService } = require('../server/service.cjs');
const { alignShots, currentIntroduction } = require('../server/product-introduction.cjs');
const { hash, shotInput } = require('../server/story-contract.cjs');
const { speechContext, speechRequest, speechEvidence } = require('../server/speech-request.cjs');

// 只验证工作流契约。文本、识别、媒体探测与生成均明确注入替身，不代表真实模型或成片质量通过。
// 全部数据在隔离临时目录中创建，不读取和修改用户的实际草稿与素材。
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'product-introduction-'));
  const originalListeners = new Set(process.listeners('exit'));
  const service = createService(dir, undefined, { manageLocalEnvironment: false });
  const ownListeners = process.listeners('exit').filter(listener => !originalListeners.has(listener));
  t.after(() => {
    for (const listener of ownListeners) process.removeListener('exit', listener);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const d = service.store.draft();
  d.product = {
    url: '', sourceRunId: '', title: '羽毛逗猫棒', description: '长杆搭配彩色羽毛和铃铛，材质PP',
    brand: '', sku: '', price: '', currency: '', specifications: [], selectedIndices: [],
    assetIds: [], imageRoles: {}, duration: 12, aspect: '9:16', brief: '',
    scriptRunId: '', shots: [], narration: true, renderMode: 'introduction',
  };
  const image = name => {
    const file = path.join(dir, name + '.png');
    fs.writeFileSync(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=', 'base64'));
    return service.store.addAsset(file);
  };
  const product = image('商品主图'), detail = image('材质详情'), icon = image('铃铛图标');
  d.product.assetIds = [product.id, detail.id, icon.id];
  d.product.imageRoles = { [product.id]: 'product', [detail.id]: 'detail', [icon.id]: 'icon' };
  const rows = [
    { text: '看看彩色羽毛。', start: 0, end: 4 },
    { text: '长杆搭配铃铛。', start: 4, end: 8 },
    { text: '材质标注为PP。', start: 8, end: 12.01 },
  ];
  let recognitionCalls = 0;
  service.providers.config = () => ({});
  service.media.probe = async file => file.endsWith('.wav')
    ? { format: { duration: '12.01' }, streams: [{ codec_type: 'audio' }] }
    : { streams: [{ codec_type: 'video', width: 750, height: 750 }] };
  service.providers.text = async (system,user,ctx,options) => options?.schema?.properties?.prompt ? {text:JSON.stringify({prompt:'The same product moves gently once and settles. Static close shot, without dialogue.'})} : ({ text: JSON.stringify({ shots: rows.map((row, index) => ({
    text: row.text, visual: index === 2 ? '商品材质细节' : '完整的羽毛逗猫棒',
    imageIndex: index === 2 ? 1 : 0, duration: 4, sellingPoint: index === 2 ? 'PP材质' : '长杆和彩色羽毛',
    evidence: index === 2 ? '商品资料标注材质PP' : '商品资料与主图',
    action: '同一根逗猫棒轻轻摆动，羽毛随之自然晃动', camera: '近景固定机位',
    stage: index === 0 ? '开场' : '介绍', iconIndices: index === 1 ? [2] : [],
  })) }) });
  service.providers.transcribe = async () => { recognitionCalls++; return { segments: structuredClone(rows), origin: 'injected-contract-recognizer' }; };
  return { service, id: d.id, d, product, detail, icon, rows, recognitionCalls: () => recognitionCalls };
}
async function preparedFixture(t, prepare = true) {
  const env = fixture(t), { service, id, d } = env;
  const script = await service.invoke('createProductScript', { id });
  d.product.scriptRunId = script.runId;
  d.product.shots = structuredClone(script.shots);
  Object.assign(d, { sourceText: script.text, rewrite: script.text, finalText: script.text, confirmed: true });
  const file = path.join(service.store.root, '当前第三步.wav');
  fs.writeFileSync(file, '明确注入的音频契约占位，不是实际生成音频');
  const audio = service.store.addAsset(file, { speech: { request: speechEvidence(speechRequest(d, speechContext(service.store.data))) } });
  d.voice.audioId = audio.id;
  const prepared = prepare ? await service.invoke('prepareProductIntroduction', { id }) : null;
  return { ...env, script, audio, prepared };
}
function videoAsset(env, name, duration) {
  const file = path.join(env.service.store.root, name + '.mp4');
  fs.writeFileSync(file, '明确注入的视频契约占位，不代表真实模型结果');
  const asset = env.service.store.addAsset(file);
  asset.duration = duration;
  return asset;
}
async function generateAndConfirm(env) {
  const { service, id } = env, calls = [];
  service.stories.generator.video = async input => {
    calls.push({ kind: 'video', input });
    return videoAsset(env, '镜头-' + calls.length, input.duration);
  };
  service.stories.generator.compose = async input => {
    calls.push({ kind: 'compose', input });
    return videoAsset(env, '合成-' + calls.length, input.shots.reduce((sum, shot) => sum + shot.duration, 0));
  };
  const episode = service.store.draft(id).story.episodes[0];
  for (const shot of episode.shots) {
    const generated = await service.invoke('generateStoryVideo', { id, episodeId: episode.id, shotId: shot.id });
    assert.equal(generated.stale, false);
    assert.equal(service.store.draft(id).story.episodes[0].shots.find(item => item.id === shot.id).selectedVideoId, '');
    await service.invoke('selectStoryVideo', { id, episodeId: episode.id, shotId: shot.id, videoId: generated.material.id });
  }
  return { calls, episodeId: episode.id };
}

test('产品分镜沿用真实ASR段落边界，24帧完整覆盖音频尾部并标明复核', () => {
  const shots = alignShots([{ text: '彩色羽毛' }, { text: '长杆铃铛' }], [
    { text: '彩色羽毛', start: .1, end: 3.5 }, { text: '长杆铃铛', start: 3.7, end: 7.011 },
  ], 7.011);
  assert.equal(shots[0].start, 0);
  assert.equal(shots[0].end, 3.5);
  assert.equal(shots[0].timing.end, 'asr-segment-end');
  assert.equal(shots[1].timing.start, 'asr-segment-end');
  assert.equal(shots[1].end, Math.ceil(7.011 * 24) / 24);
  assert(shots.every(shot => shot.timing.requiresReview && Math.abs(shot.duration * 24 - Math.round(shot.duration * 24)) < 1e-8));
  assert.equal(shots.reduce((sum, shot) => sum + shot.duration, 0), shots.at(-1).end);
});
test('ASR段内切镜头明确标注插值估计，不能伪装成识别器词级边界', () => {
  const shots = alignShots([{ text: '彩色' }, { text: '羽毛长杆' }], [{ text: '彩色羽毛长杆', start: 0, end: 6 }], 6);
  assert.equal(shots[0].end, 2);
  assert.equal(shots[0].timing.end, 'asr-segment-interpolation-estimate');
  assert.equal(shots[1].timing.start, 'asr-segment-interpolation-estimate');
  assert(shots.every(shot => shot.timing.requiresReview));
});
test('镜头拒绝缺字、多字、超长和不足五帧的台词时间', () => {
  assert.throws(() => alignShots([{ text: '彩色羽毛' }], [{ text: '羽毛', start: 0, end: 3 }], 3), /逐字对应/);
  assert.throws(() => alignShots([{ text: '羽毛' }], [{ text: '彩色羽毛', start: 0, end: 3 }], 3), /逐字对应/);
  assert.throws(() => alignShots([{ text: '羽毛' }], [{ text: '羽毛', start: 0, end: 16 }], 16), /超出/);
  assert.throws(() => alignShots([{ text: '羽' }, { text: '毛' }], [{ text: '羽毛', start: 0, end: .3 }], .3), /不足|超出/);
});
test('准备产品介绍通过服务入口保留确认稿、原图角色、台词动作和识别证据', async t => {
  const { service, id, d, product, detail, icon, audio, prepared } = await preparedFixture(t);
  const story = prepared.story, episode = story.episodes[0];
  assert.equal(prepared.stale, false);
  assert.equal(prepared.qualityAccepted, false);
  assert.equal(d.finalText, story.sourceText);
  assert.equal(d.confirmed, true);
  assert.equal(episode.shots.map(shot => shot.text).join('\n'), d.finalText);
  assert.deepEqual(story.assets.map(asset => asset.role), ['product', 'detail', 'icon']);
  assert.equal(story.productIntroduction.audioId, audio.id);
  assert.equal(episode.narrationAssetId, audio.id);
  assert.equal(episode.shots[0].selectedImageId, product.id);
  assert.equal(episode.shots[2].selectedImageId, detail.id);
  assert.deepEqual(episode.shots[1].iconIds, [icon.id]);
  assert(episode.shots.every(shot => shot.action.includes('晃动') && shot.sellingPoint && shot.evidence));
  for (const shot of episode.shots) assert.equal(shot.images[0].inputHash, hash(shotInput(story, shot)));
  assert.equal(story.productIntroduction.recognition.origin, 'injected-contract-recognizer');
  assert.equal(story.productIntroduction.proofreading.requiresListening, false);
  assert.equal(story.productIntroduction.captions.map(row => row.text).join(''), d.finalText.replace(/\n/g, ''));
  assert.equal(currentIntroduction(service, d, story), true);
  assert.equal(service.store.data.runs.find(run => run.id === prepared.runId).type, 'product-introduction');
});
test('未确认稿、缺少第三步配音和镜头台词不同步时拒绝准备', async t => {
  const { service, id, d } = await preparedFixture(t, false);
  d.confirmed = false;
  await assert.rejects(service.invoke('prepareProductIntroduction', { id }), /第二步确认/);
  d.confirmed = true;
  const audioId = d.voice.audioId; d.voice.audioId = '';
  await assert.rejects(service.invoke('prepareProductIntroduction', { id }), /第三步.*配音/);
  d.voice.audioId = audioId; d.product.shots[0].text = '另一段完全不同的台词';
  await assert.rejects(service.invoke('prepareProductIntroduction', { id }), /台词不一致/);
  assert.equal(service.store.data.runs.some(run => run.type === 'product-introduction'), false);
});
test('确认稿只修改标点也必须先同步镜头，准备阶段即拒绝而非生成视频后才失败', async t => {
  const env = await preparedFixture(t, false), { service, id, d, audio } = env;
  const before = structuredClone(d.story);
  d.finalText = d.finalText.replace('。', '！');
  audio.speech.request = speechEvidence(speechRequest(d, speechContext(service.store.data)));
  await assert.rejects(service.invoke('prepareProductIntroduction', { id }), /台词不一致|同步镜头/);
  assert.equal(env.recognitionCalls(), 0);
  assert.deepEqual(d.story, before);
  assert.equal(service.store.data.runs.some(run => run.type === 'product-introduction'), false);
});
test('图标序号越界、非整数、重复、过量或引用非图标时准备阶段即拒绝', async t => {
  const env = await preparedFixture(t, false), { service, id, d } = env;
  const before = structuredClone(d.story);
  for (const iconIndices of [[-1], [999], [1.5], ['2'], [2, 2], [0], [2, 2, 2, 2, 2]]) {
    d.product.shots[1].iconIndices = iconIndices;
    await assert.rejects(service.invoke('prepareProductIntroduction', { id }), /图标/);
    assert.deepEqual(d.story, before);
  }
  assert.equal(env.recognitionCalls(), 0);
  assert.equal(service.store.data.runs.some(run => run.type === 'product-introduction'), false);
});
test('第三步音频必须带当前文案、音色参数的speechEvidence', async t => {
  const { service, id, d, audio } = await preparedFixture(t, false);
  const request = structuredClone(audio.speech.request);
  delete audio.speech;
  await assert.rejects(service.invoke('prepareProductIntroduction', { id }), /第三步配音.*不匹配/);
  audio.speech = { request: { ...request, textSha256: hash('旧稿') } };
  await assert.rejects(service.invoke('prepareProductIntroduction', { id }), /第三步配音.*不匹配/);
  audio.speech.request = request; d.voice.speed = Number(d.voice.speed) + .1;
  await assert.rejects(service.invoke('prepareProductIntroduction', { id }), /第三步配音.*不匹配/);
});
test('ASR文字缺失、数字或否定变化拒绝生成时间轴，不覆盖既有故事', async t => {
  const { service, id, d, rows } = await preparedFixture(t, false);
  const before = structuredClone(d.story);
  for (const text of ['看看彩色。', '看看二色羽毛。', '不要彩色羽毛。']) {
    service.providers.transcribe = async () => ({ segments: [{ ...rows[0], text }, ...rows.slice(1)] });
    await assert.rejects(service.invoke('prepareProductIntroduction', { id }), /识别与确认稿差异/);
    assert.deepEqual(d.story, before);
    const failed = service.store.data.runs.find(run => run.type === 'product-introduction');
    assert.equal(failed.failureOutput.referenceText, d.finalText);
    assert.equal(failed.failureOutput.audioId, d.voice.audioId);
    assert.equal(failed.failureOutput.recognition.segments[0].text, text);
  }
});
test('识别期间商品资料变化只留下过期证据，不写入半套分镜', async t => {
  const { service, id, d, rows } = await preparedFixture(t, false);
  const before = structuredClone(d.story);
  service.providers.transcribe = async () => {
    d.product.description += '识别期间用户修改';
    return { segments: structuredClone(rows) };
  };
  const output = await service.invoke('prepareProductIntroduction', { id });
  assert.equal(output.stale, true);
  assert.deepEqual(d.story, before);
  assert.equal(service.store.data.runs.find(run => run.id === output.runId).output.stale, true);
});
test('准备时停止任务立即中止挂接，不会写入自动选用的故事或视频', async t => {
  const { service, id, d, rows } = await preparedFixture(t, false);
  const before = structuredClone(d.story);
  service.providers.transcribe = async (_audioId, ctx) => {
    const run = service.store.data.runs.find(item => item.type === 'product-introduction' && item.status === 'running');
    service.runtime.cancel(run.id);
    ctx.signal.throwIfAborted();
    return { segments: structuredClone(rows) };
  };
  await assert.rejects(service.invoke('prepareProductIntroduction', { id }), /abort|取消/i);
  assert.deepEqual(d.story, before);
  assert.equal(service.store.data.runs.find(run => run.type === 'product-introduction').status, 'cancelled');
  assert.equal(d.video.assetId, '');
});
test('第三步素材探测没有有效音轨时不调用识别且保留旧故事', async t => {
  const env = await preparedFixture(t, false), { service, id, d } = env;
  const before = structuredClone(d.story);
  service.media.probe = async () => ({ format: { duration: '12.01' }, streams: [{ codec_type: 'video' }] });
  await assert.rejects(service.invoke('prepareProductIntroduction', { id }), /有效音轨/);
  assert.equal(env.recognitionCalls(), 0);
  assert.deepEqual(d.story, before);
});
test('仅提供图标不能生成商品脚本，也不能将图标作为产品主镜头', async t => {
  const env = fixture(t), { service, id, d, product, detail, icon } = env;
  d.product.assetIds = [icon.id];
  await assert.rejects(service.invoke('createProductScript', { id }), /图标不能替代/);
  d.product.assetIds = [product.id, detail.id, icon.id];
  const text = service.providers.text;
  service.providers.text = async (...args) => {
    const result = await text(...args), value = JSON.parse(result.text);
    value.shots[0].imageIndex = 2;
    return { text: JSON.stringify(value) };
  };
  await assert.rejects(service.invoke('createProductScript', { id }), /图标替代/);
});
test('商品资料、图片用途、图片文件和音频文件变化均使准备结果失效', async t => {
  const { service, d, product, audio, prepared } = await preparedFixture(t), story = prepared.story;
  d.product.description += '增加资料'; assert.equal(currentIntroduction(service, d, story), false);
  d.product.description = story.productIntroduction.productSnapshot.description;
  d.product.imageRoles[product.id] = 'icon'; assert.equal(currentIntroduction(service, d, story), false);
  d.product.imageRoles[product.id] = 'product';
  const oldImage = fs.readFileSync(product.path);
  fs.appendFileSync(product.path, '改变图片内容'); assert.equal(currentIntroduction(service, d, story), false);
  fs.writeFileSync(product.path, oldImage);
  fs.appendFileSync(audio.path, '改变配音内容'); assert.equal(currentIntroduction(service, d, story), false);
});
test('旧商品资料、图片用途和原图文件变化不能套用旧脚本重新准备', async t => {
  const { service, id, d, product } = await preparedFixture(t, false);
  const description = d.product.description;
  d.product.description += '不同商品';
  await assert.rejects(service.invoke('prepareProductIntroduction', { id }), /资料或所选素材已变化/);
  d.product.description = description; d.product.imageRoles[product.id] = 'detail';
  await assert.rejects(service.invoke('prepareProductIntroduction', { id }), /资料或所选素材已变化/);
  d.product.imageRoles[product.id] = 'product'; fs.appendFileSync(product.path, '不同图片');
  await assert.rejects(service.invoke('prepareProductIntroduction', { id }), /原素材已变化/);
});
test('相同输入再次准备保持故事ID、已生成候选和人工选用状态，不重复识别', async t => {
  const env = await preparedFixture(t), { service, id } = env;
  await generateAndConfirm(env);
  const before = structuredClone(service.store.draft(id).story), calls = env.recognitionCalls();
  const next = await service.invoke('prepareProductIntroduction', { id });
  assert.equal(next.unchanged, true);
  assert.deepEqual(next.story, before);
  assert.equal(env.recognitionCalls(), calls);
  assert.equal(service.store.data.runs.filter(run => run.type === 'product-introduction').length, 1);
});
test('普通故事保存不能删除或重写服务端商品介绍凭据，也不能给普通故事伪造凭据', async t => {
  const env = await preparedFixture(t), { service, id } = env;
  const before = structuredClone(service.store.draft(id).story);
  for (const change of [
    story => { delete story.productIntroduction; },
    story => { story.productIntroduction.productHash = hash('伪造商品来源'); },
    story => { story.productIntroduction.audioSha256 = hash('伪造配音来源'); },
    story => { story.productIntroduction.images = []; },
  ]) {
    const story = structuredClone(before); change(story);
    await assert.rejects(service.invoke('saveStory', { id, story, revision: before.revision }), /来源凭据.*服务端/);
    assert.deepEqual(service.store.draft(id).story, before);
  }
  const ordinary = fixture(t), fake = structuredClone(before);
  fake.revision = 0;
  await assert.rejects(ordinary.service.invoke('saveStory', { id: ordinary.id, story: fake, revision: 0 }), /来源凭据.*服务端/);
  assert.equal(ordinary.service.store.draft(ordinary.id).story, undefined);
});
test('商品介绍不能将分集旁白换成其他音频，保存和当前状态检查均拒绝', async t => {
  const { service, id, d, audio } = await preparedFixture(t), before = structuredClone(d.story);
  const otherFile = path.join(service.store.root, '另一条旁白.wav');
  fs.writeFileSync(otherFile, '另一条不应被选用的旁白');
  const other = service.store.addAsset(otherFile, { duration: audio.duration, speech: structuredClone(audio.speech) });
  const story = structuredClone(before); story.episodes[0].narrationAssetId = other.id;
  await assert.rejects(service.invoke('saveStory', { id, story, revision: before.revision }), /第三步旁白|重新准备分镜/);
  assert.deepEqual(service.store.draft(id).story, before);
  assert.equal(currentIntroduction(service, d, story), false);
});
test('商品介绍不能关闭旁白或改为独立剧本、多集模式，拒绝时保留已准备数据', async t => {
  const { service, id, d } = await preparedFixture(t), before = structuredClone(d.story);
  for (const change of [
    story => { story.narrationMode = 'none'; },
    story => { story.sourceMode = 'custom'; },
    story => { story.episodeCount = 2; },
    story => { story.episodes[0].text += '擅改台词'; },
  ]) {
    const story = structuredClone(before); change(story);
    await assert.rejects(service.invoke('saveStory', { id, story, revision: before.revision }), /确认稿.*第三步旁白|重新准备分镜/);
    assert.deepEqual(service.store.draft(id).story, before);
    if (story.episodes[0].text === before.episodes[0].text) assert.equal(currentIntroduction(service, d, story), false);
  }
});
test('资料变更后拒绝继续生成和合成，禁止让过期产品分镜进入GPU任务', async t => {
  const { service, id, d } = await preparedFixture(t), episode = d.story.episodes[0];
  d.product.title = '另一件产品';
  const before = service.store.data.runs.length;
  await assert.rejects(service.invoke('generateStoryVideo', { id, episodeId: episode.id, shotId: episode.shots[0].id }), /商品资料.*变化/);
  await assert.rejects(service.invoke('composeStoryEpisode', { id, episodeId: episode.id }), /商品资料.*变化/);
  assert.equal(service.store.data.runs.length, before);
});
test('动态模型失败保留已有候选，不回退原图展示或自动交接', async t => {
  const { service, id, d } = await preparedFixture(t), episode = d.story.episodes[0], shot = episode.shots[0];
  const before = structuredClone(d.story);
  service.stories.generator.video = async () => { throw Error('明确注入的模型生成失败'); };
  await assert.rejects(service.invoke('generateStoryVideo', { id, episodeId: episode.id, shotId: shot.id }), /模型生成失败/);
  assert.deepEqual(d.story, before);
  assert.equal(d.video.assetId, '');
  assert.equal(d.edit.sourceId, '');
  assert.equal(service.store.data.runs.find(run => run.type === 'story-video').status, 'failed');
  assert.equal(service.store.data.runs.some(run => run.type === 'product-video'), false);
});
test('产品动态镜头逐一确认后合成，使用第三步旁白并交接第五步且保留确认稿', async t => {
  const env = await preparedFixture(t), { service, id, d, audio } = env;
  const { calls, episodeId } = await generateAndConfirm(env), text = d.finalText;
  const composed = await service.invoke('composeStoryEpisode', { id, episodeId });
  assert.equal(composed.stale, false);
  const input = calls.find(call => call.kind === 'compose').input;
  assert.equal(input.narration.assetId, audio.id);
  assert.equal(input.shots.length, 3);
  assert(input.productIntroduction);
  assert.deepEqual(input.shots[1].iconIds, [env.icon.id]);
  assert(calls.filter(call => call.kind === 'video').every(call => call.input.productIntroduction));
  await service.invoke('useStoryEpisode', { id, episodeId });
  assert.equal(d.step, 4);
  assert.equal(d.edit.sourceId, composed.material.id);
  assert.equal(d.video.assetId, composed.material.id);
  assert.equal(d.voice.audioId, audio.id);
  assert.equal(d.finalText, text);
  assert.equal(d.confirmed, true);
  assert.equal(d.story.activeEpisodeId, episodeId);
  assert.equal(d.cover.assetId, '');
  assert.equal(d.publish.videoId, '');
});
test('已交接产品介绍修改上游确认稿后清除剪辑、封面与发布引用', async t => {
  const env = await preparedFixture(t), { service, id } = env;
  const { episodeId } = await generateAndConfirm(env);
  await service.invoke('composeStoryEpisode', { id, episodeId });
  await service.invoke('useStoryEpisode', { id, episodeId });
  const before = service.store.draft(id);
  before.edit.resultId = '旧剪辑'; before.cover.assetId = '旧封面'; before.publish.videoId = '旧发布';
  const next = structuredClone(before); next.finalText += '新文案';
  const saved = service.store.updateDraft(next);
  assert.equal(saved.video.assetId, '');
  assert.equal(saved.edit.sourceId, '');
  assert.equal(saved.edit.resultId, '');
  assert.equal(saved.cover.assetId, '');
  assert.equal(saved.publish.videoId, '');
  assert.equal(saved.story.episodes[0].resultId, '');
});
test('已交接产品介绍修改商品资料后撤销旧成片，下游不能继续消费旧商品', async t => {
  const env = await preparedFixture(t), { service, id } = env;
  const { episodeId } = await generateAndConfirm(env);
  await service.invoke('composeStoryEpisode', { id, episodeId });
  await service.invoke('useStoryEpisode', { id, episodeId });
  const next = structuredClone(service.store.draft(id));
  next.product.description += '用户新增商品资料';
  const saved = service.store.updateDraft(next);
  assert.equal(saved.video.assetId, '');
  assert.equal(saved.edit.sourceId, '');
  assert.equal(saved.edit.resultId, '');
  assert.equal(saved.cover.assetId, '');
  assert.equal(saved.publish.videoId, '');
});

// 卖点及其来源影响实际叠加内容与可核对性，编辑后必须经同一失效链撤销旧成片。
for (const field of ['sellingPoint', 'evidence']) {
  test('产品' + field + '编辑使旧镜头和合成结果失效，并撤销第五步旧成片交接', async t => {
    const env = await preparedFixture(t), { service, id } = env;
    const { episodeId } = await generateAndConfirm(env);
    const composed = await service.invoke('composeStoryEpisode', { id, episodeId });
    await service.invoke('useStoryEpisode', { id, episodeId });
    const d = service.store.draft(id), before = structuredClone(d.story);
    const previousShot = before.episodes[0].shots[0], oldVideoId = previousShot.selectedVideoId;
    const unchangedShots = before.episodes[0].shots.slice(1).map(shot => ({ id: shot.id, imageId: shot.selectedImageId, videoId: shot.selectedVideoId }));
    assert.equal(d.edit.sourceId, composed.material.id);
    assert.equal(d.step, 4);
    d.edit.resultId = '旧剪辑结果';
    d.cover.assetId = '旧封面结果'; d.cover.videoId = '旧封面视频';
    d.publish.videoId = '旧待发布视频'; d.publish.coverId = '旧待发布封面'; d.publish.recordId = '旧发布记录';
    const story = structuredClone(before);
    story.episodes[0].shots[0][field] += field === 'sellingPoint' ? '，展示商品细节' : '，请人工复核资料来源';
    const saved = await service.invoke('saveStory', { id, story, revision: before.revision });
    const episode = saved.story.episodes[0], shot = episode.shots[0], current = service.store.draft(id);
    assert.equal(shot[field], story.episodes[0].shots[0][field]);
    assert.notEqual(hash(shotInput(before, previousShot)), hash(shotInput(saved.story, shot)));
    assert.equal(shot.selectedImageId, '');
    assert.equal(shot.selectedVideoId, '');
    assert(shot.images.length > 0 && shot.images.every(candidate => candidate.status === 'stale'));
    assert(shot.videos.length > 0 && shot.videos.every(candidate => candidate.status === 'stale'));
    assert.equal(episode.resultId, '');
    assert.equal(episode.resultInputHash, '');
    assert(episode.results.some(candidate => candidate.id === composed.material.id));
    for (const unaffected of unchangedShots) {
      const other = episode.shots.find(item => item.id === unaffected.id);
      assert.equal(other.selectedImageId, unaffected.imageId);
      assert.equal(other.selectedVideoId, unaffected.videoId);
      assert(other.videos.every(candidate => candidate.status === 'ready'));
    }
    assert.equal(current.video.assetId, '');
    assert.equal(current.edit.sourceId, '');
    assert.equal(current.edit.resultId, '');
    assert.equal(current.cover.assetId, '');
    assert.equal(current.cover.videoId, '');
    assert.equal(current.publish.videoId, '');
    assert.equal(current.publish.coverId, '');
    assert.equal(current.publish.recordId, '');
    assert.equal(current.finalText, before.sourceText);
    assert.equal(current.voice.audioId, env.audio.id);
    assert.deepEqual(saved.story.productIntroduction, before.productIntroduction);
    assert(fs.existsSync(service.store.asset(oldVideoId).path));
    assert(fs.existsSync(service.store.asset(composed.material.id).path));
    await assert.rejects(service.invoke('selectStoryVideo', { id, episodeId, shotId: shot.id, videoId: oldVideoId }), /过期/);
    await assert.rejects(service.invoke('composeStoryEpisode', { id, episodeId }), /未确认|过期/);
    await assert.rejects(service.invoke('useStoryEpisode', { id, episodeId }), /未确认|过期|没有匹配镜头/);
  });
}

test('产品新成片交接前已有旧字幕时归档旧字幕，保留新旁白字幕且不复用旧校对', async t => {
  const env = await preparedFixture(t), { service, id } = env;
  const { episodeId } = await generateAndConfirm(env);
  const composed = await service.invoke('composeStoryEpisode', { id, episodeId });
  const d = service.store.draft(id), oldVideo = videoAsset(env, '历史有字幕视频', 12.01);
  const oldRows = [{ start: 0, end: 2, text: '历史视频独有的旧字幕', auxiliary: { sourceText: '历史视频独有的旧字幕', text: '旧辅助文本' } }];
  const oldProofread = { sourceId: oldVideo.id, referenceSha256: hash('旧确认稿'), captionsSha256: hash(JSON.stringify(oldRows)), method: 'injected-old-proofread' };
  d.video.assetId = oldVideo.id;
  d.edit.sourceId = oldVideo.id;
  d.edit.captions = structuredClone(oldRows);
  d.edit.subtitleProofread = structuredClone(oldProofread);
  const expectedCaptions = structuredClone(d.story.productIntroduction.captions);
  await service.invoke('useStoryEpisode', { id, episodeId });
  const saved = service.store.draft(id);
  assert.equal(saved.step, 4);
  assert.equal(saved.edit.sourceId, composed.material.id);
  assert.equal(saved.video.assetId, composed.material.id);
  assert.equal(saved.edit.subtitlesEnabled, true);
  assert.deepEqual(saved.edit.captions, expectedCaptions);
  assert.equal(saved.edit.subtitleProofread, undefined);
  const archived = saved.artifacts.captionHistory.find(item => item.sourceId === oldVideo.id);
  assert(archived);
  assert.deepEqual(archived.rows, oldRows);
  assert.deepEqual(archived.proofread, oldProofread);
  assert(fs.existsSync(service.store.asset(oldVideo.id).path));
});

test('编辑产品镜头后允许显式重选同一imported原图，仅恢复当前首帧而不复活旧视频', async t => {
  const env = await preparedFixture(t), { service, id, product } = env;
  const { episodeId } = await generateAndConfirm(env);
  const before = structuredClone(service.store.draft(id).story), previous = before.episodes[0].shots[0];
  assert.equal(previous.selectedImageId, product.id);
  assert(previous.images.some(candidate => candidate.id === product.id && candidate.imported));
  const story = structuredClone(before); story.episodes[0].shots[0].action += '，镜头中保持主体完整可见';
  await service.invoke('saveStory', { id, story, revision: before.revision });
  const stale = service.store.draft(id).story.episodes[0].shots[0];
  assert.equal(stale.selectedImageId, '');
  assert.equal(stale.selectedVideoId, '');
  assert(stale.images.some(candidate => candidate.id === product.id && candidate.status === 'stale'));
  const selected = await service.invoke('selectStoryImage', { id, episodeId, shotId: previous.id, imageId: product.id });
  const shot = selected.story.episodes[0].shots[0];
  assert.equal(shot.selectedImageId, product.id);
  assert(shot.images.some(candidate => candidate.id === product.id && candidate.imported && candidate.status === 'ready' && candidate.inputHash === hash(shotInput(selected.story, shot))));
  assert.equal(shot.selectedVideoId, '');
  assert(shot.videos.every(candidate => candidate.status === 'stale'));
  assert.equal(selected.story.episodes[0].resultId, '');
  await assert.rejects(service.invoke('selectStoryVideo', { id, episodeId, shotId: previous.id, videoId: previous.selectedVideoId }), /过期/);
});

test('编辑产品镜头后旧模型生成图仍然过期，不能借显式重选原图规则恢复', async t => {
  const env = await preparedFixture(t), { service, id, product } = env;
  const generatedFile = path.join(service.store.root, '明确注入的模型生成图.png');
  fs.copyFileSync(product.path, generatedFile);
  const generatedImage = service.store.addAsset(generatedFile, { origin: 'injected-image-generation-contract' });
  service.stories.generator.image = async () => generatedImage;
  const episode = service.store.draft(id).story.episodes[0], shotId = episode.shots[0].id;
  const generated = await service.invoke('generateStoryImage', { id, episodeId: episode.id, shotId });
  assert.equal(generated.stale, false);
  assert.notEqual(generated.candidate.imported, true);
  await service.invoke('selectStoryImage', { id, episodeId: episode.id, shotId, imageId: generatedImage.id });
  const before = structuredClone(service.store.draft(id).story), story = structuredClone(before);
  story.episodes[0].shots[0].action += '，采用新动作要求';
  await service.invoke('saveStory', { id, story, revision: before.revision });
  const afterEdit = structuredClone(service.store.draft(id).story);
  assert.equal(afterEdit.episodes[0].shots[0].selectedImageId, '');
  assert(afterEdit.episodes[0].shots[0].images.some(candidate => candidate.id === generatedImage.id && candidate.status === 'stale' && candidate.imported !== true));
  await assert.rejects(service.invoke('selectStoryImage', { id, episodeId: episode.id, shotId, imageId: generatedImage.id }), /过期/);
  assert.deepEqual(service.store.draft(id).story, afterEdit);
});

test('ASR期间原地替换同长度音频字节必须拒绝，不能将旧识别时间轴绑定新音频并建立故事', async t => {
  const { service, id, d, audio, rows } = await preparedFixture(t, false);
  const before = structuredClone(d.story), original = fs.readFileSync(audio.path), replaced = Buffer.from(original);
  replaced[0] ^= 0xff;
  assert.equal(replaced.length, original.length);
  assert.notDeepEqual(replaced, original);
  let called = false;
  service.providers.transcribe = async () => {
    called = true;
    fs.writeFileSync(audio.path, replaced);
    return { segments: structuredClone(rows), origin: 'injected-recognition-from-original-audio' };
  };
  await assert.rejects(service.invoke('prepareProductIntroduction', { id }), /配音|音频/);
  assert.equal(called, true);
  assert.deepEqual(d.story, before);
  assert.equal(service.store.draft(id).story, undefined);
  const run = service.store.data.runs.find(item => item.type === 'product-introduction');
  assert(run);
  assert.equal(run.status, 'failed');
  assert.equal(run.output, undefined);
  assert.equal(d.video.assetId, '');
  assert.equal(d.edit.sourceId, '');
});

test('中文镜头翻译期间发生修改，不提交过期GPU任务且保留原候选',async t=>{const env=await preparedFixture(t),{service,id,d}=env,episode=d.story.episodes[0],shot=episode.shots[0];let submitted=0;service.providers.text=async()=>{d.story.episodes[0].shots[0].action='用户已改为向右摆动';return {text:JSON.stringify({prompt:'The same product swings left and settles.'})};};service.stories.generator.video=async()=>{submitted++;throw Error('不应提交');};await assert.rejects(service.invoke('generateStoryVideo',{id,episodeId:episode.id,shotId:shot.id}),/翻译期间已变化/);assert.equal(submitted,0);assert.equal(d.story.episodes[0].shots[0].action,'用户已改为向右摆动');assert.equal(d.story.episodes[0].shots[0].videos.length,0);});
