// 在产品播放器记录连续播放，不跳播、不提速，刷新后核对同一任务和产物。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const directory = path.resolve(__dirname, '../evidence/validation/musetalk-long-20261116');
const mode = process.argv[2], runId = '08c818fb-9bdb-42c1-88e8-15314c63bd5b';
const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2), { flag: 'wx' });
async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9371');
  try {
    const page = browser.contexts()[0].pages()[0];
    const call = (action, payload = {}) => page.evaluate(({ action, payload }) => window.studio.invoke(action, payload), { action, payload });
    if (mode === 'status') {
      console.log(JSON.stringify(await page.evaluate(() => {
        const record = window.__longPlayback;
        const video = document.querySelector('video[aria-label="视频预览"]');
        return { currentTime: video?.currentTime, ended: video?.ended, paused: video?.paused, recordPresent: !!record, samples: record?.samples.length, error: record?.error };
      })));
      return;
    }
    const state = await call('state'), run = state.runs.find(item => item.id === runId);
    assert.equal(run?.status, 'succeeded', '原长片任务尚未成功，不启动播放');
    const prepared = read('prepared.json');
    const draft = state.drafts.find(item => item.id === prepared.draftId);
    assert.equal(draft.video.assetId, run.output.id);
    if (mode === 'start') {
      assert(!fs.existsSync(path.join(directory, 'playback-start.json')), '已有播放记录，请先查询原播放器状态');
      assert.equal(state.currentId, prepared.draftId);
      await page.locator('.steps>button').nth(3).click();
      const video = page.getByLabel('视频预览', { exact: true });
      await video.waitFor();
      await page.waitForFunction(() => document.querySelector('video[aria-label="视频预览"]')?.readyState >= 2);
      const started = await video.evaluate(async node => {
        const record = window.__longPlayback = { startedAt: new Date().toISOString(), samples: [], seekingEvents: 0, pageErrors: [], ended: false, error: null };
        window.addEventListener('error', event => record.pageErrors.push(event.message));
        const sample = () => record.samples.push({ time: node.currentTime, rate: node.playbackRate, muted: node.muted, volume: node.volume, wall: Date.now() });
        node.currentTime = 0;
        node.playbackRate = 1;
        node.muted = false;
        node.volume = 1;
        await node.play();
        node.addEventListener('seeking', () => record.seekingEvents++);
        node.addEventListener('error', () => { record.error = node.error?.message || '媒体播放错误'; });
        sample();
        const timer = setInterval(sample, 500);
        node.addEventListener('ended', () => { sample(); clearInterval(timer); record.ended = true; record.endedAt = new Date().toISOString(); record.quality = { totalVideoFrames: node.getVideoPlaybackQuality().totalVideoFrames, droppedVideoFrames: node.getVideoPlaybackQuality().droppedVideoFrames }; }, { once: true });
        return { startedAt: record.startedAt, source: node.currentSrc, duration: node.duration, muted: node.muted, rate: node.playbackRate };
      });
      write('playback-start.json', { runId, draftId: draft.id, assetId: run.output.id, runCount: state.runs.length, started });
      await page.screenshot({ path: path.join(directory, 'long-product-playing.png') });
      console.log(JSON.stringify(started));
      return;
    }
    assert.equal(mode, 'finish');
    const record = await page.evaluate(() => window.__longPlayback);
    assert(record, '当前页面没有连续播放记录');
    assert(record.ended, '播放器尚未播放结束，请继续观察同一播放器');
    assert.equal(record.error, null);
    assert.deepEqual(record.pageErrors, []);
    assert.equal(record.seekingEvents, 0, '播放期间发生跳转，不能认定连续完整播放');
    assert(record.samples.every(item => item.rate === 1 && item.muted === false && item.volume > 0));
    assert(record.samples[0].time < 1);
    assert(Math.abs(record.samples.at(-1).time - prepared.expected.duration) < 0.05);
    assert(record.samples.every((item, index) => index === 0 || item.time - record.samples[index - 1].time < 2));
    await page.screenshot({ path: path.join(directory, 'long-product-ended.png') });
    await page.reload();
    await page.getByLabel('视频预览', { exact: true }).waitFor();
    const refreshed = await call('state');
    assert.equal(refreshed.runs.length, state.runs.length);
    assert.equal(refreshed.drafts.find(item => item.id === prepared.draftId).video.assetId, run.output.id);
    const source = await page.getByLabel('视频预览', { exact: true }).getAttribute('src');
    assert(source?.includes(run.output.id), '刷新后播放器没有引用同一素材');
    write('long-product-playback.json', { at: new Date().toISOString(), runId, assetId: run.output.id, fullNativePlaybackToEnded: true, unmuted: true, speed: 1, refreshBinding: true, noNewSubmissionAfterReload: true, record, qualityAccepted: false, characterMatchAccepted: false });
    console.log(JSON.stringify({ fullPlayback: true, duration: record.samples.at(-1).time, refreshBinding: true, samples: record.samples.length }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
