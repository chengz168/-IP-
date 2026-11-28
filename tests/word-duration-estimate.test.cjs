const test=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('../src/word-duration-estimate.mjs');
test('预设字数显示预计视频时长并注明仅根据字数粗估',async()=>{const {estimateWordDuration:f}=await load();for(const [n,min,max]of [[200,40,67],[300,60,100],[500,100,167],[800,160,267],[1000,200,334]]){const v=f(n);assert.equal(v.minSeconds,min);assert.equal(v.maxSeconds,max);assert.match(v.text,/预计视频时长/);assert.match(v.explanation,/估算参数/);assert.match(v.explanation,/以实际成片为准/);}});
test('自定义字数正常估算，但空白非整数和非正数不显示误导范围',async()=>{const {estimateWordDuration:f}=await load();assert.equal(f('135').minSeconds,27);for(const n of ['', ' ',0,-10,'12.5',NaN,Infinity,'abc',Number.MAX_VALUE])assert.equal(f(n),null);});
test('当前语速参与估算，更快缩短、更慢延长',async()=>{const {estimateWordDuration:f}=await load();assert.deepEqual([f(300,2).minSeconds,f(300,2).maxSeconds],[30,50]);assert.deepEqual([f(300,.5).minSeconds,f(300,.5).maxSeconds],[120,200]);assert.equal(f(300,'1.25').minSeconds,48);});
test('非法或超出界面范围的语速安全回到默认，不产生无限时长',async()=>{const {estimateWordDuration:f}=await load();for(const speed of [0,-1,NaN,Infinity,'abc',3])assert.equal(f(200,speed).speed,1);});
test('极短和较长自定义字数均明确范围，纯画面和剧情不冒报精准预测',async()=>{const {estimateWordDuration:f}=await load();assert.equal(f(1).text,'预计视频时长 1 秒');assert.equal(f(2000).maxSeconds,667);assert.match(f(1000).explanation,/纯画面或剧情视频不能仅凭字数确定/);});
