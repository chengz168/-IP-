const test=require('node:test'),assert=require('node:assert/strict');
const {pinyinRows}=require('../server/subtitle-pinyin.cjs');
const {toColorTemplateAss:color,colorSubtitleIds,colorMetrics}=require('../server/color-template-subtitles.cjs');
const {toBilingualTemplateAss:bilingual,bilingualSubtitleIds,bilingualMetrics}=require('../server/bilingual-template-subtitles.cjs');
const {subtitlePreviewCount,subtitleEngineVersion,subtitleOutputCurrent}=require('../server/subtitle-output.mjs');
const {generateAuxiliary}=require('../server/subtitle-auxiliary.cjs');
const rows=(n=5,text='甲乙丙')=>Array.from({length:n},(_,i)=>({start:i*2,end:i*2+1,text,auxiliary:{sourceText:text,translation:'Make every step count',keywords:['甲']}}));
const events=r=>r.ass.split('\n').filter(s=>s.startsWith('Dialogue:'));
const pins=input=>input.map(r=>Array.from(r.text,c=>/[\u3400-\u4dbf\u4e00-\u9fff]/.test(c)?'jiǎ':''));

test('注音固定负5间距、原基字号拼音间隔、逐字透明度与600ms窗口',()=>{
 const input=rows(1),r=color(input,1920,1080,'white_pinyin','fixture',{pinyin:pins(input)}),e=events(r);
 assert.equal(e.length,6);assert.match(e[0],/\\bord2\\shad0\\an2\\pos\(915,860\)\\fs50\\alpha&H80&\\t\(0,200,1.0,/);
 assert.match(e[1],/\\bord1\\shad0\\an2\\pos\(915,813\)\\fs16\\alpha&H99&/);
 assert.match(e[2],/\\pos\(960,860\).*\\t\(200,400,1.0,/);assert.match(e[4],/\\pos\(1005,860\).*\\t\(400,600,1.0,/);
});
test('注音长字拟合58%下限，拼音字号和原字号距离不随缩字改变',()=>{
 const input=rows(1,'字'.repeat(100)),r=color(input,360,640,'white_pinyin','fixture',{pinyin:pins(input)}),e=events(r);
 assert.equal(r.details[0].fittedFontSize,16);assert.match(e[0],/\\fs16\\alpha&H80&/);assert.match(e[1],/\\pos\([^,]+,485\)\\fs9/);
 assert.deepEqual(colorMetrics('white_pinyin',360,640),{fontSize:27,safeWidth:308});
});
test('注音多行从底线上移110且支持CRLF和补充平面字符不拆分',()=>{
 const input=rows(1,'甲😀\r\n乙A，𠀀'),r=color(input,1920,1080,'white_pinyin','fixture',{pinyin:pins(input)}),e=events(r);
 assert.equal(e.length,8);assert.ok(e.some(s=>s.includes(',750)')&&s.endsWith('甲')));assert.ok(e.some(s=>s.includes(',860)')&&s.endsWith('乙')));
 assert.equal(e.filter(s=>s.endsWith('😀')).length,1);assert.equal(e.filter(s=>s.endsWith('𠀀')).length,1);assert.equal(e.filter(s=>s.endsWith('jiǎ')).length,2);
 assert.throws(()=>color(input,1920,1080,'white_pinyin','fixture',{pinyin:[[]]}),/未逐字对齐/);
});
test('内置注音逐单字查音，忽略ASCII标点换行及补充平面字',async()=>{
 const text='重庆银行音乐A，\n𠀀',output=(await pinyinRows([text]))[0];
 assert.equal(output.length,Array.from(text).length);assert.deepEqual(output.slice(0,8),['zhòng','qìng','yín','háng','yīn','lè','','']);assert.deepEqual(output.slice(8),['','']);
});
test('综艺四句双层clip、Pink/Green逐字reset共享到下层，第二句延下一尾',()=>{
 const r=color(rows(4),1920,1080,'variety_wave','fixture'),e=events(r);assert.equal(e.length,8);assert.deepEqual(r.details.map(d=>d.endCs),[100,500,500,700]);
 assert.match(e[0],/Pink.*\\pos\(960,800\)\\clip\(0,580,1920,800\)/);assert.match(e[1],/White.*\\clip\(0,800,1920,1020\)/);
 assert.ok(e[1].includes('甲{\\rPink}'));assert.ok(e[5].includes('丙{\\rGreen}'));
 assert.match(e[0],/\\frz-6.0\\t\(36,196,1.6,.*\\fscy136/);assert.match(e[2],/\\blur3\\fscy100\\frz-3.6\\t\(30,170,1.5,/);
});
test('综艺偏移同时移动pos与clip，固定毫秒不跟随速度缩短',()=>{
 const r=color(rows(4),360,640,'variety_wave','fixture',{offsetY:200,speed:2});assert.equal(r.shift,119);assert.equal(r.details[1].startCs,100);assert.match(events(r)[0],/\\pos\(180,355\)\\clip\(0,225,360,355\)/);assert.ok(r.ass.includes('\\t(0,160,1.6,'));
});
test('卡通没有拟合，五句颜色缩放移动半透明和带光标增长',()=>{
 const r=color(rows(),1920,1080,'cartoon_yellow','fixture'),e=events(r);assert.deepEqual(r.details.map(d=>d.endCs),[300,300,500,900,900]);
 assert.match(e[0],/\\bord0\\shad3\\an5\\1c&HACFEF6&\\pos\(960,860\)\\fscx150/);
 assert.match(e[1],/\\move\(1080,970,960,910,0,260\).*\\t\(35,95,1.2,/);assert.match(e[2],/\\t\(240,320,1.0,/);assert.match(e[3],/\\alpha&H50&.*\\alpha&H50&/);
 assert.ok(e[4].endsWith('甲|'));assert.equal(e.at(-1).endsWith('|'),false);
 const long=color(rows(1,'字'.repeat(100)),360,640,'cartoon_yellow','fixture');assert.equal(long.details[0].fittedFontSize,null);
});
test('活力随机组一保留两色随机选择，完整阶段不含光标',()=>{
 const values=[0,.8,0,.2],r=color(rows(2),1920,1080,'energy_pink_yellow','fixture',{random:()=>values.shift()}),e=events(r);
 assert.deepEqual(r.details.map(d=>d.group),[1,1]);assert.equal(r.details[0].color,'&H8DF2F1&');assert.equal(r.details[1].color,'&HCC96F8&');assert.ok(e[0].endsWith('甲|'));assert.equal(e[3].endsWith('|'),false);
});
test('活力随机组二双行wave、上句延下一尾、无综艺的reset',()=>{
 const r=color(rows(2),1920,1080,'energy_pink_yellow','fixture',{random:()=>.4}),e=events(r);assert.equal(e.length,2);assert.deepEqual(r.details.map(d=>[d.startCs,d.endCs]),[[0,300],[200,300]]);
 assert.match(e[0],/\\1c&HCC96F8&\\pos\(960,760\).*\\frz-2.4\\t\(34,194,1.6,/);assert.match(e[1],/\\1c&H8DF2F1&\\pos\(960,820\)/);assert.equal(r.ass.includes('\\r'),false);
});
test('活力随机组三上下弹入和两侧向中心clip动画，所有裁剪也移动',()=>{
 const r=color(rows(2),360,640,'energy_pink_yellow','fixture',{random:()=>.9,offsetY:200}),e=events(r);assert.equal(e.length,3);
 assert.match(e[0],/\\move\(180,313,180,331,0,260\).*\\t\(220,320,1.2,/);
 assert.match(e[1],/\\pos\(180,367\)\\clip\(0,213,0,521\)\\t\(0,320,1.2,\\clip\(0,213,180,521\)\)/);
 assert.match(e[2],/\\clip\(360,213,360,521\)\\t\(0,320,1.2,\\clip\(180,213,360,521\)\)/);
});
test('活力不足尾两句回退单句，正式默认调用Math.random而非固定循环',()=>{
 const original=Math.random;let calls=0;try{Math.random=()=>{calls++;return .9;};const r=color(rows(1),1920,1080,'energy_pink_yellow','fixture');assert.equal(r.details[0].group,1);assert.equal(calls,2);}finally{Math.random=original;}
 assert.equal(colorMetrics('energy_pink_yellow',1920,1080).fontSize,70);assert.equal(colorMetrics('energy_pink_yellow',360,640).fontSize,37);
});
test('可爱彩色固定负间距与左右对齐，第二四句延长，逐字50/75/50ms',()=>{
 const r=color(rows(),1920,1080,'cute_pink','fixture'),e=events(r);assert.deepEqual(r.details.map(d=>d.endCs),[100,500,500,900,900]);assert.match(r.ass,/100,100,-15,0,1,3,0,5/);
 assert.match(e[0],/\\fsp-12\\an5\\pos\(960,840\)\\1c&HF9F4AE&\\fad\(300,0\)/);
 assert.match(e[1],/\\an4\\pos\(80,790\).*\\t\(50,125,\\alpha&H00&\\fscx120\\fscy120\)\\t\(125,175,/);
 assert.match(e[2],/\\an6\\pos\(1840,890\)/);assert.match(e[3],/\\move\(960,740,960,790,0,500\)/);assert.match(e[4],/\\1c&H6AEEF8&/);
});
test('黑白双语英文在上、中文在下、灰底border3和原始字号行高',()=>{
 const r=bilingual(rows(1),1920,1080,'black_white_bilingual','fixture'),e=events(r);assert.equal(e.length,2);assert.match(r.ass,/Style: BoxStyleEng,fixture,20,.*&H00737373&,-1,.*3,2,0,5,30,30/);
 assert.match(e[0],/BoxStyleEng.*\\pos\(960,942\)/);assert.match(e[1],/BoxStyleChs.*\\pos\(960,994\)/);assert.equal(r.ass.includes('\\t('),false);
});
test('黑白双语长句缩字下限中62%英55%，行高仍按原始字号',()=>{
 const input=rows(1,'字'.repeat(100));input[0].auxiliary.translation='W'.repeat(1000);const r=bilingual(input,360,640,'black_white_bilingual','fixture'),e=events(r);
 assert.equal(r.details[0].chsFontSize,15);assert.equal(r.details[0].engFontSize,6);assert.match(e[0],/\\pos\(180,536\)/);assert.match(e[1],/\\pos\(180,567\)/);
});
test('黄白双语四句pos后move顺序与中黄英白、固定阴影1',()=>{
 const r=bilingual(rows(4),1920,1080,'yellow_white_bilingual','fixture'),e=events(r);assert.equal(e.length,8);
 assert.match(e[0],/\\bord3\\shad1.*\\1c&H00D7FF&\\pos\(960,840\)\\move\(960,858,960,840,0,260\)/);
 assert.match(e[1],/\\pos\(960,880\)\\fs18\\bord0\\shad0\\fad\(220,0\)/);
 assert.match(e[2],/\\t\(28,83,1.3,/);assert.match(e[4],/\\pos\(960,840\)\\move\(1040,840,960,840,0,240\)/);assert.match(e[6],/\\t\(22,67,1.3,/);assert.match(e[7],/\\fad\(160,0\)/);
});
test('红白双语第二句延长、第三句仅中文红字，第四句逐字',()=>{
 const r=bilingual(rows(4),1920,1080,'red_white_bilingual','fixture'),e=events(r);assert.equal(e.length,7);assert.deepEqual(r.details.map(d=>d.endCs),[100,500,500,700]);
 assert.match(e[0],/Chs.*\\pos\(960,994\)\\fad\(200,0\)/);assert.match(e[2],/Chs.*\\t\(35,95,1.2,/);assert.match(e[4],/Red.*\\pos\(960,1048\)\\fad\(200,0\)/);assert.match(e[5],/Chs.*\\t\(0,60,1.2,/);
});
test('红白按字和词分别折行并在超过两倍容量时缩字，正文多行不丢',()=>{
 const input=rows(1,'甲乙丙丁戊己庚辛壬癸'.repeat(3));input[0].auxiliary.translation='Make every step count and preserve every original detail carefully';const r=bilingual(input,360,640,'red_white_bilingual','fixture'),e=events(r),m=bilingualMetrics('red_white_bilingual',360,640);
 assert.equal(m.chsMax,11);assert.equal(r.details[0].chsLines,3);assert.equal(r.details[0].chsFontSize,17);assert.ok(e[0].includes('甲\\N乙'));
 assert.ok(r.details[0].engLines>1);assert.ok(e[1].includes('\\N'));const multi=rows(1,'甲\n乙\n丙');assert.ok(bilingual(multi,1920,1080,'yellow_white_bilingual','fixture').ass.includes('甲\\N乙\\N丙'));
});
test('双语负偏移及倍速只移动实际位置和事件时段，不缩短动效',()=>{
 const r=bilingual(rows(4),360,640,'yellow_white_bilingual','fixture',{offsetY:-200,speed:1.25});assert.equal(r.shift,-119);assert.equal(r.details[1].startCs,160);assert.match(events(r)[0],/\\pos\(180,617\)\\move\(180,628,180,617,0,260\)/);
});
test('关键词多次命中与未命中恢复、ASS转义、输入不变及取消',()=>{
 const input=rows(5,'甲乙甲{\\pos(0,0)}😀'),before=JSON.stringify(input);
 for(const id of [...colorSubtitleIds,...bilingualSubtitleIds]){
  const fn=colorSubtitleIds.includes(id)?color:bilingual,opts={keywords:true,pinyin:pins(input),random:()=>.4},r=fn(input,1920,1080,id,'fixture',opts);
  assert.equal(r.ass.includes('{\\pos(0,0)}'),false);assert.equal(r.ass.includes('😀'),true);assert.ok(r.ass.includes('\\c&H6CCBF3&'));
  assert.equal(JSON.stringify(input),before);const controller=new AbortController();controller.abort();assert.throws(()=>fn(input,1920,1080,id,'fixture',{...opts,signal:controller.signal}),/abort/i);
 }
});
test('八套空列表/极短时段不会增加尾部事件，原有产物均失效并保留正确预览周期',()=>{
 const counts=[6,4,5,6,5,2,4,4];for(const [i,id]of [...colorSubtitleIds,...bilingualSubtitleIds].entries()){
  const fn=colorSubtitleIds.includes(id)?color:bilingual,input=rows(1);input[0].end=.01;const r=fn(input,1920,1080,id,'fixture',{pinyin:pins(input),random:()=>0});assert.ok(events(r).every(s=>!s.includes(',0:00:00.02,')));assert.equal(fn([],1920,1080,id,'fixture',{pinyin:[]}).eventCount,0);
  assert.equal(subtitleEngineVersion(id),id==='white_pinyin'?3:2);assert.equal(subtitlePreviewCount(id),counts[i]);assert.equal(subtitleOutputCurrent({edit:{subtitlesEnabled:true,subtitleMode:'template',subtitleTemplate:id}},{renderedSubtitleTemplate:{templateId:id,engineVersion:1}}),false);
 }
});
test('双语辅助保留原版内容要求和本机JSON校验协议，错误序号不得写入',async()=>{
 let prompt='',calls=0;const providers={config:()=>({baseUrl:'http://127.0.0.1:9999/v1',model:'configured-local'}),text:async(p)=>{prompt=p;calls++;return {text:'[{"index":0,"translation":"Make every step count"}]'};}};
 const draft={video:{assetId:''},edit:{captions:rows(1)}};const result=await generateAuxiliary(providers,draft,'translation',{});assert.equal(result.rows[0].auxiliary.sourceText,'甲乙丙');assert.equal(result.model,'configured-local');assert.equal(calls,1);
 for(const text of ['每句单独翻译','简洁、自然、口语化','不要包含任何标点符号','JSON数组','index和translation'])assert.ok(prompt.includes(text));
 providers.text=async()=>({text:'[{"index":1,"translation":"Wrong"}]'});await assert.rejects(generateAuxiliary(providers,draft,'translation',{}),/序号不符/);
});
