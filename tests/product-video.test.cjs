const test=require('node:test');
const assert=require('node:assert/strict');
const {timedShots}=require('../server/product-video.cjs');
test('商品镜头覆盖完整音频，边界连续且保持25帧网格',()=>{
 const shots=timedShots([{duration:3,text:'甲'},{duration:4,text:'乙'},{duration:3,text:'丙'}],12.123);
 assert.equal(shots[0].start,0);assert.equal(shots.at(-1).end,12.16);
 for(let i=0;i<shots.length;i++){assert.ok(shots[i].duration>0);assert.ok(Math.abs(shots[i].end*25-Math.round(shots[i].end*25))<.0001);if(i)assert.equal(shots[i].start,shots[i-1].end);}
 assert.deepEqual(shots.map(s=>s.text),['甲','乙','丙']);
});
test('过短配音不能吞掉商品镜头',()=>assert.throws(()=>timedShots([{duration:1},{duration:1},{duration:1}],.04),/过短/));
const {productCaptions}=require('../server/product-captions.cjs');
test('繁简和极少等长错字按确认稿留痕校对，保持真实识别时间轴',()=>{
 const reference='想给猫咪挑一款互动玩具？先看看这款羽毛逗猫棒。长杆搭配彩色羽毛，还有铃铛，外观可以对照这些商品原图。页面标注材质为PP，选购前记得确认款式、尺寸和使用方式。想了解更多细节，可以打开商品页慢慢看。';
 const raw='想給貓咪挑一款互動玩具先看看這款羽毛動貓棒長感搭配彩色羽毛還有鈴鐺外觀可以對照這些商品圓圖頁面標注材質為PP選購前記得確認款式尺寸和使用方式想了解更多細節可以打開商品頁慢慢看';
 const result=productCaptions([{start:0,end:16.3,text:raw}],reference);assert.equal(result.captions[0].text,reference);assert.equal(result.captions[0].end,16.3);assert.equal(result.proofreading.readingDifferences,1);assert.equal(result.proofreading.requiresListening,true);assert.equal(result.proofreading.rawText,raw);
});
test('字幕少字、显著错句、数字或否定变化必须拒绝',()=>{
 for(const [raw,reference]of [['你好','你好朋友'],['今天展示全新商品','明天去看不同产品'],['价格999元','价格199元'],['这个不能使用','这个都能使用']])assert.throws(()=>productCaptions([{start:0,end:3,text:raw}],reference),/差异/);
});
