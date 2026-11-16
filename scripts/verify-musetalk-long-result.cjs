const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { verifyReceipt } = require('../server/local-musetalk.cjs');
const { sourceIndex } = require('../integrations/musetalk-local/production-input.cjs');

const root = path.resolve(__dirname, '..');
const evidence = path.join(root, 'evidence', 'validation', 'musetalk-long-20261116');
const workspace = path.join(evidence, 'workspace');
const ffmpeg = 'F:/Software/轻语IP智能体/aigc-human/resources/ffmpeg/bin/ffmpeg.exe';
const ffprobe = 'F:/Software/轻语IP智能体/aigc-human/resources/ffmpeg/bin/ffprobe.exe';
const runId = '08c818fb-9bdb-42c1-88e8-15314c63bd5b';
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const command = (file, args) => {
  const result = spawnSync(file, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
};

function main() {
  const studio = readJson(path.join(workspace, 'studio.json'));
  const run = studio.runs.find(item => item.id === runId);
  if (!run) throw new Error('未找到长片任务');
  if (run.status === 'running' || run.status === 'queued') throw new Error('长片任务仍在运行，不能提前验收');
  const worker = run.local?.directory;
  if (!worker || !fs.existsSync(worker)) throw new Error('缺少本地口型工作目录');
  const resultFile = path.join(worker, 'result.json');
  if (!fs.existsSync(resultFile)) throw new Error('缺少本地口型最终回执');
  const receipt = readJson(resultFile);
  const plan = readJson(path.join(worker, 'input-snapshot.json'));
  const prepared = readJson(path.join(evidence, 'prepared.json'));
  const candidate = path.join(worker, 'candidate.mp4');
  const report = {
    at: new Date().toISOString(),
    runId,
    runStatus: run.status,
    worker,
    receipt,
    source: prepared.source,
    plan,
    output: { path: candidate, exists: fs.existsSync(candidate) },
    checks: {},
    qualityAccepted: false,
    referenceParityAccepted: false
  };
  if (!fs.existsSync(candidate)) {
    fs.writeFileSync(path.join(evidence, 'long-media-report.json'), JSON.stringify(report, null, 2));
    throw new Error('长片回执没有对应输出视频');
  }
  const probe = command(ffprobe, ['-v', 'error', '-count_frames', '-show_entries', 'format=duration:stream=index,codec_type,width,height,r_frame_rate,avg_frame_rate,sample_rate,channels,nb_frames,nb_read_frames,duration,start_time', '-of', 'json', candidate]);
  if (probe.status !== 0) throw new Error('FFprobe 失败：' + probe.stderr);
  report.output.sha256 = sha256(candidate);
  report.output.probe = JSON.parse(probe.stdout);
  const decode = command(ffmpeg, ['-v', 'error', '-xerror', '-i', candidate, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
  report.checks.fullDecodeExitCode = decode.status;
  report.checks.fullDecodeVerified = decode.status === 0 && !decode.stderr.trim();
  const video = report.output.probe.streams?.find(item => item.codec_type === 'video');
  const audio = report.output.probe.streams?.find(item => item.codec_type === 'audio');
  report.checks.videoFrames = Number(video?.nb_read_frames || 0);
  report.checks.videoShape = { width: Number(video?.width || 0), height: Number(video?.height || 0), fps: video?.avg_frame_rate || video?.r_frame_rate || '' };
  report.checks.videoDuration = Number(video?.duration);
  report.checks.audioDuration = Number(audio?.duration);
  report.checks.durationMatches = Math.abs(report.checks.videoDuration - prepared.expected.duration) < 1 / prepared.expected.fps && Math.abs(report.checks.audioDuration - plan.audioDuration) < 0.05;
  report.checks.streamsValid = report.output.probe.streams.filter(item => item.codec_type === 'video').length === 1 && report.output.probe.streams.filter(item => item.codec_type === 'audio').length === 1 && Number(audio?.nb_read_frames) > 0;
  report.checks.frameCountMatches = report.checks.videoFrames === 6240;
  report.checks.shapeMatches = report.checks.videoShape.width === 1080 && report.checks.videoShape.height === 1920 && report.checks.videoShape.fps === '30/1';
  try {
    verifyReceipt(worker, plan);
    report.checks.receiptVerified = true;
  } catch (error) {
    report.checks.receiptVerified = false;
    report.checks.receiptError = error.message;
  }
  const asset = studio.assets.find(item => item.id === run.output?.id);
  const draft = studio.drafts.find(item => item.id === prepared.draftId);
  report.asset = asset;
  report.checks.assetHashMatches = !!asset && sha256(asset.path) === report.output.sha256 && asset.lipSync?.outputSha256 === report.output.sha256;
  report.checks.bindingMatches = !!asset && draft?.video.assetId === asset.id && asset.origin === 'local-musetalk';
  report.checks.sourcesUnchanged = sha256(prepared.source.path) === prepared.source.sha256 && sha256(plan.video.path) === plan.video.sha256 && sha256(plan.audio.path) === plan.audio.sha256 && sha256(prepared.audio.path) === prepared.audio.sha256;
  // 每帧记录证明处理覆盖范围，不能替代口型质量人工验收。
  const measurements = fs.readFileSync(path.join(worker, 'face-measurements.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  report.checks.everyFrameProcessed = measurements.length === plan.frameCount && measurements.every((item, index) => item.frame === index && item.sourceFrame === sourceIndex(index, plan.sourceFrameCount) && item.outsideFaceBoxIdenticalBeforeEncoding === true && item.changedPixelsInsideFaceBox > 0);
  const timeline = command(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', candidate]);
  assert.equal(timeline.status, 0, timeline.stderr);
  const times = JSON.parse(timeline.stdout).frames.map(item => Number(item.best_effort_timestamp_time));
  report.checks.timelineMatches = times.length === plan.frameCount && times.every((time, index) => Number.isFinite(time) && Math.abs(time - index / plan.fps) < 0.00001);
  const pcm = input => {
    const result = spawnSync(ffmpeg, ['-v', 'error', '-i', input, '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.status, 0, String(result.stderr));
    return result.stdout;
  };
  const originalPcm = pcm(plan.audio.path), outputPcm = pcm(candidate);
  report.checks.audioWindows = [0, 60, 120, 180, 200].map(start => {
    const first = start * 16000, last = Math.min(first + 8 * 16000, originalPcm.length / 2, outputPcm.length / 2);
    let aa = 0, bb = 0, ab = 0;
    for (let i = first; i < last; i++) { const a = originalPcm.readInt16LE(i * 2), b = outputPcm.readInt16LE(i * 2); aa += a * a; bb += b * b; ab += a * b; }
    return { start, samples: last - first, correlation: aa && bb ? ab / Math.sqrt(aa * bb) : null };
  });
  report.checks.audioPreserved = report.checks.audioWindows.every(item => item.samples > 0 && item.correlation > 0.95);
  report.checks.technicalComplete = run.status === 'succeeded' && ['fullDecodeVerified', 'frameCountMatches', 'shapeMatches', 'durationMatches', 'streamsValid', 'receiptVerified', 'assetHashMatches', 'bindingMatches', 'sourcesUnchanged', 'everyFrameProcessed', 'timelineMatches', 'audioPreserved'].every(key => report.checks[key] === true);
  const framesDir = path.join(evidence, 'long-sampled-frames');
  fs.mkdirSync(framesDir, { recursive: true });
  report.sampledFrames = [];
  for (const time of [0, 20, 60, 100, 140, 180, 207.5]) {
    const file = path.join(framesDir, `frame-${String(time).replace('.', '_')}s.png`);
    const frame = command(ffmpeg, ['-y', '-ss', String(time), '-i', candidate, '-frames:v', '1', '-vf', 'scale=540:-1', file]);
    if (frame.status !== 0) throw new Error(`抽帧失败：${time}s ${frame.stderr}`);
    const frameIndex = Math.round(time * plan.fps), measurement = measurements[frameIndex];
    const sourceTime = measurement.sourceFrame / plan.fps;
    const sourceFile = path.join(framesDir, `source-${String(time).replace('.', '_')}s.png`);
    const sourceFrame = command(ffmpeg, ['-v', 'error', '-y', '-ss', String(sourceTime), '-i', plan.video.path, '-frames:v', '1', '-vf', 'scale=540:-1', sourceFile]);
    assert.equal(sourceFrame.status, 0, sourceFrame.stderr);
    const [left, top, right, bottom] = measurement.box;
    const crop = `crop=${right - left}:${bottom - top}:${left}:${top},scale=360:-1`;
    const pairFile = path.join(framesDir, `face-pair-${String(time).replace('.', '_')}s.png`);
    const pair = command(ffmpeg, ['-v', 'error', '-y', '-ss', String(sourceTime), '-i', plan.video.path, '-ss', String(time), '-i', candidate, '-filter_complex', `[0:v]${crop}[source];[1:v]${crop}[result];[source][result]hstack=inputs=2[pair]`, '-map', '[pair]', '-frames:v', '1', pairFile]);
    assert.equal(pair.status, 0, pair.stderr);
    report.sampledFrames.push({ time, frameIndex, sourceTime, file, sha256: sha256(file), sourceFile, pairFile, pairSha256: sha256(pairFile) });
  }
  fs.writeFileSync(path.join(evidence, 'long-media-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ technicalComplete: report.checks.technicalComplete, fullDecode: report.checks.fullDecodeVerified, frames: report.checks.videoFrames, sampled: report.sampledFrames.length }, null, 2));
  assert.equal(report.checks.technicalComplete, true, '长片技术验收未通过，详见 long-media-report.json');
}

try { main(); } catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
