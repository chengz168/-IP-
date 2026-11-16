const {test}=require('node:test');
const assert=require('node:assert/strict');
const load=()=>import('../server/copy-quality.mjs');
const ordinary={source:{kind:'user'}},reference={source:{kind:'reference-visible'}};
const source='清晨先把书桌整理干净，把常用的文具放回原处，然后打开窗户让空气流通。晚上记得检查台灯是否关闭，再把当天用过的书籍收好。';
const highReuse='清晨先把书桌整理干净，把常用的文具放回原处，然后打开窗户让空气流通。晚上记得检查台灯是否关闭，再把当天用过的书籍放好。';

test('普通模板正文大段逐字沿用仅提示重组复核，不修改输出或自动确认',async()=>{
 const {assessRewrite}=await load(),output=highReuse,before=JSON.stringify(ordinary),result=assessRewrite(source,output,output.length,ordinary);
 assert.equal(result.status,'needs-review');assert.equal(result.accepted,false);assert.deepEqual(result.issues,[]);assert(result.warnings.some(value=>value.includes('超过75%')&&value.includes('专名可合理保留')));assert.equal(output,highReuse);assert.equal(JSON.stringify(ordinary),before);
});

test('普通模板适度重写不会因事实含义与原文一致而误拒或误报字面高复用',async()=>{
 const {assessRewrite}=await load(),output='桌面归整之后，将经常使用的笔和尺放到固定位置，开窗换换空气。一天结束时先关灯，再把阅读材料摆回书架。',result=assessRewrite(source,output,output.length,ordinary);
 assert.equal(result.status,'needs-review');assert.equal(result.accepted,false);assert.deepEqual(result.issues,[]);assert.equal(result.warnings.some(value=>value.includes('连续8字')),false);
});

test('空原文、空输出、短文本和不足8字原文均不产生复用比例NaN',async()=>{
 const {assessRewrite}=await load();for(const [input,output] of [['',''],['','先把书桌整理干净，再将常用文具分类，开窗换气，结束之后关灯并整理书籍。'],['短句',''],['关灯。','记得关灯。'],['先整理','请把桌上散落的文件收进抽屉，再给笔筒找一个方便取用的位置，最后擦拭桌面。']]){
  const result=assessRewrite(input,output,output.length,ordinary);assert.equal(result.warnings.some(value=>value.includes('连续8字')),false);assert.equal(result.accepted,false);for(const value of Object.values(result))if(typeof value==='number')assert.equal(Number.isNaN(value),false);
 }
});

test('首段长度与保留开头限制仅属于原厂模板，普通模板不扩大限制',async()=>{
 const {assessRewrite}=await load(),output='桌面归整之后，将经常使用的笔和尺放到固定位置，开窗换换空气，一天结束先关灯再摆好书籍。';assert(output.length>30);
 const normal=assessRewrite(source,output,output.length,ordinary),original=assessRewrite(source,output,output.length,reference);assert.equal(normal.status,'needs-review');assert.equal(normal.issues.some(value=>value.includes('首段')),false);assert.equal(original.status,'rejected');assert(original.issues.some(value=>value.includes('首段不超过30字')));assert(original.issues.some(value=>value.includes('保留原文开头')));
});

test('原厂模板保持首段排除与后文复用提示，合法短开头仍可待复核',async()=>{
 const {assessRewrite}=await load(),input='先整理桌面。'+source,output='先整理桌面。\n'+highReuse,result=assessRewrite(input,output,output.length,reference);
 assert.equal(result.status,'needs-review');assert(result.warnings.includes('后文超过75%的文字位于原文连续8字片段中，重组程度需复核'));assert.equal(result.accepted,false);
});

test('普通与原厂模板完全相同或仅标点变化仍拒绝，不被复用警告放行',async()=>{
 const {assessRewrite}=await load();for(const template of [ordinary,reference])for(const output of [source,source.replaceAll('。','！')]){const result=assessRewrite(source,output,output.length,template);assert.equal(result.status,'rejected');assert(result.issues.includes('输出与原文相同，未形成有效改写'));assert.equal(result.accepted,false);}
});

test('专名与固定表述密集的合理保留可以警告，但不据此拒绝',async()=>{
 const {assessRewrite}=await load(),input='阅读角整理指南建议保持通道畅通，阅读角整理指南建议按类别放书，阅读角整理指南建议用完归位。',output='阅读角整理指南建议保持通道畅通，阅读角整理指南建议按类别放书，阅读角整理指南建议及时归位。',result=assessRewrite(input,output,output.length,ordinary);
 assert.equal(result.status,'needs-review');assert.deepEqual(result.issues,[]);assert(result.warnings.some(value=>value.includes('专名可合理保留')));assert.equal(result.accepted,false);
});
