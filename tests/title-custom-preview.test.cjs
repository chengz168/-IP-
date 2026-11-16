const test=require('node:test'),assert=require('node:assert/strict');
const layout=import('../src/title-custom-preview.mjs'),model=import('../server/title-model.mjs');
async function fixture(width=1080,height=1920){const m=await model;return m.titleSnapshot({title:'主标题',subtitle:'副标题',titleDesign:m.titleDesign({})},width,height);}

test('自定义标题按原生视频缩放，效果单独按1080×1920缩放且保留三位',async()=>{
 const m=await layout,s=await fixture(360,640),r=m.customTitleLayout(s,{width:200,height:355.555});assert.equal(r.nativeScale,.556);assert.equal(r.effectScale,.185);assert.equal(r.fontSize,56*.556);
 assert.equal(m.titlePreviewScale({width:1,height:1}),.12);assert.equal(m.titlePreviewScale({width:0,height:0}),.42);assert.equal(m.titlePreviewScale({}),.42);
 const horizontal=m.customTitleLayout(await fixture(1920,1080),{width:480,height:270});assert.equal(horizontal.nativeScale,.25);assert.equal(horizontal.effectScale,.141);
});
test('两行固定2像素间距、不换行、同色、字号至少12像素',async()=>{
 const m=await layout,s=await fixture();s.style.fontSize=24;s.style.secondaryColor='#FF0000';const r=m.customTitleLayout(s,{width:100,height:100});assert.equal(r.fontSize,12);assert.equal(r.style.lineHeight,'1');assert.equal(r.style.gap,'2px');assert.equal(r.lineStyle.whiteSpace,'nowrap');assert.equal(r.lineStyle.color,'inherit');assert.deepEqual(r.lines,['主标题','副标题']);assert.equal(r.style.fontWeight,900);
 s.main='';assert.equal(m.customTitleLayout(s).lines[0],'主标题示例');assert.deepEqual(m.customTitleLayout(s,undefined,{preview:false}).lines,['副标题']);s.sub='';assert.deepEqual(m.customTitleLayout(s,undefined,{preview:false}).lines,[]);
});
test('位置以原生高度计算并限制2%到86%，关闭背景仍保留padding',async()=>{
 const m=await layout,s=await fixture(360,640);s.style.top=120;let r=m.customTitleLayout(s,{width:180,height:320});assert.equal(r.topPercent,18.75);assert.equal(r.style.transform,'translateX(-50%)');assert.equal(r.style.padding,'6px 12px');assert.equal(r.style.background,'transparent');
 s.design.offsetY=-10000;assert.equal(m.customTitleLayout(s).topPercent,2);s.design.offsetY=10000;assert.equal(m.customTitleLayout(s).topPercent,86);
 s.style.background.enabled=true;s.style.background.opacity=.5;s.style.background.color='#123456';s.style.opacity=.6;r=m.customTitleLayout(s);assert.equal(r.style.background,'#12345680');assert.equal(r.style.opacity,.6);assert.equal(r.style.borderRadius,'18px');
});
test('描边先量化半像素再缩放，阴影按原版CSS模糊规则输出',async()=>{
 const m=await layout,s=await fixture();assert.equal(m.titleStrokeWidth(1.26,.333),.5);assert.equal(m.titleStrokeWidth(30,1),6);assert.equal(m.titleStrokeWidth(-1,1),0);assert.equal(m.titleStrokeWidth(NaN,1),2);
 s.style.stroke={enabled:true,width:1.26,color:'#123456'};s.style.shadow={enabled:true,color:'#654321',distance:3,opacity:.1};const r=m.customTitleLayout(s,{width:360,height:640});assert.equal(r.style.WebkitTextStroke,'0.5px #123456');assert.equal(r.style.textShadow,'0 1px 5.328px #654321');
 s.style.shadow.opacity=1;assert.equal(m.customTitleLayout(s,{width:360,height:640}).style.textShadow,r.style.textShadow);
});
test('自定义拖动按下即映射原生高度，应用24/72像素边界并拒绝无效坐标',async()=>{
 const {customTitlePointerTop:f}=await layout,r={top:100,height:400};assert.equal(f(300,r,1920),960);assert.equal(f(0,r,1920),115);assert.equal(f(1000,r,1920),1574);assert.equal(f(300,r,640),320);
 for(const args of [[NaN,r,640],[300,{top:100,height:0},640],[300,r,Infinity]])assert.equal(f(...args),null);
});
test('模式往返保留有效顶部，历史负偏移与最大正偏移仍可保存且不修改原对象',async()=>{
 const m=await model;for(const offsetY of [120,-600,10000]){const edit={titleDesign:m.titleDesign({})};edit.titleDesign.custom.top=500;edit.titleDesign.offsetY=offsetY;const before=JSON.stringify(edit),expected=500+offsetY;
 const next=m.switchTitleMode(edit,'template');assert.equal(JSON.stringify(edit),before);assert.equal(next.custom.top+next.offsetY,expected);m.validateTitleDesign(next);
 const again=m.switchTitleMode({titleDesign:next},'custom');assert.equal(again.custom.top+again.offsetY,expected);m.validateTitleDesign(again);assert.equal(m.titleSnapshot({titleDesign:again},360,640).version,3);
 }
});
