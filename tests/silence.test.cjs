const {test}=require('node:test');
const assert=require('node:assert/strict');
const {silenceTimeline,remapCaptions,silenceOptions}=require('../server/silence.cjs');
test('静音剪辑保留两侧缓冲，同时裁掉头尾静音，字幕映射到连续时间轴',()=>{
  const timeline=silenceTimeline('silence_start: 0\nsilence_end: 1\nsilence_start: 3\nsilence_end: 5\nsilence_start: 7\nsilence_end: 8',8,.1);
  assert.deepEqual(timeline.keep,[{start:.9,end:3.1},{start:4.9,end:7.1}]);assert.ok(Math.abs(timeline.duration-4.4)<1e-8);
  const rows=remapCaptions([{start:1,end:3,text:'第一段'},{start:3.5,end:4.5,text:'静音内应删除'},{start:4,end:6,text:'跨越静音'}],timeline.keep);
  assert.equal(rows.length,2);assert.ok(Math.abs(rows[0].start-.1)<1e-8);assert.ok(Math.abs(rows[1].start-2.2)<1e-8);assert.ok(Math.abs(rows[1].end-3.3)<1e-8);
});
test('无静音保持原时轴，全静音和非法参数明确拒绝',()=>{
  assert.deepEqual(silenceTimeline('',5,.1).keep,[{start:0,end:5}]);assert.throws(()=>silenceTimeline('silence_start: 0',5,.1),/没有可保留/);assert.throws(()=>silenceOptions({silenceThreshold:0}),/参数无效/);
});
test('跨越剪口的字幕分成两段，不让字幕漂移到其他语句',()=>{
  const rows=remapCaptions([{start:1,end:6,text:'同一句'}],[{start:0,end:2},{start:4,end:7}]);assert.deepEqual(rows,[{start:1,end:2,text:'同一句'},{start:2,end:4,text:'同一句'}]);
});
