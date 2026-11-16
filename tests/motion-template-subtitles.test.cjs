const test=require('node:test'),assert=require('node:assert/strict');
const {toMotionTemplateAss,purpleCharWidth,motionSubtitleIds}=require('../server/motion-template-subtitles.cjs');
const {subtitleOutputCurrent,subtitlePreviewCount}=require('../server/subtitle-output.mjs');
const input=(count=7)=>Array.from({length:count},(_,i)=>({start:i*2,end:i*2+1,text:'甲乙丙'}));
const lines=ass=>ass.split('\n').filter(s=>s.startsWith('Dialogue:'));

test('三行滚动双描边、底部对齐与首尾行数，karaoke覆盖延长后的正空档',()=>{
 const rows=input(3),before=JSON.stringify(rows),r=toMotionTemplateAss(rows,1920,1080,'scrolling_3lines','fixture');assert.equal(r.eventCount,14);assert.match(r.ass,/Style: Active,fixture,45,.*,-1,-1,.*1,200,100,20,1/);assert.match(r.ass,/Style: Inactive,fixture,30,/);
 assert.match(lines(r.ass)[0],/\\bord6\\3c&HFFFFFF&.*\\move\(200,800,250,800,0,200\)/);assert.match(lines(r.ass)[1],/\\bord2\\3c&H000000&/);assert.match(lines(r.ass)[0],/\{\\k67\}甲\{\\k67\}乙\{\\k66\}丙$/);
 assert.match(lines(r.ass)[4],/Inactive.*\\alpha&H80&.*\\move\(250,800,250,735,0,300\)/);assert.deepEqual(r.details.map(d=>d.endCs),[200,400,500]);assert.equal(JSON.stringify(rows),before);
});

test('滚动空档恰好10秒不填补，小于10秒填补，重叠不缩短本行',()=>{
 const rows=[{start:0,end:1,text:'字幕'},{start:11,end:12,text:'字幕'},{start:21.99,end:24,text:'字幕'},{start:23,end:25,text:'字幕'}],r=toMotionTemplateAss(rows,1920,1080,'scrolling_4lines','fixture');assert.deepEqual(r.details.map(d=>d.endCs),[100,2199,2400,2500]);
});

test('四行顶部对齐、单次描绘和后第二句；竖屏位置使用各轴独立取整',()=>{
 const r=toMotionTemplateAss(input(4),360,640,'scrolling_4lines','fixture',{offsetY:200});assert.equal(r.eventCount,12);assert.equal(r.shift,119);assert.match(r.ass,/Style: Active,fixture,27,.*7,38,100,100,1/);
 assert.match(lines(r.ass)[0],/\\move\(38,355,47,355,0,200\)/);assert.match(lines(r.ass)[2],/Inactive.*\\pos\(38,433\)/);assert.match(lines(r.ass)[3],/\\move\(47,355,47,316,0,300\)/);
});

test('滚动长句使用75%下限，inactive仍保留原句拟合标签，不擅自恢复小字号',()=>{
 const rows=input(2);rows[0].text='长'.repeat(100);const r=toMotionTemplateAss(rows,1920,1080,'scrolling_3lines','fixture');assert.equal(r.details[0].fittedFontSize,34);assert.match(lines(r.ass)[4],/Inactive.*\{\\fs34\}/);
});

test('3D每三句分组，进入前景200ms，下一组开始时转后景并保留至再下一组',()=>{
 const r=toMotionTemplateAss(input(7),1920,1080,'3d_flip','fixture');assert.equal(r.eventCount,14);assert.deepEqual(r.details.slice(0,4).map(d=>[d.startCs,d.frontEndCs,d.backEndCs]),[[0,600,1200],[200,600,1200],[400,600,1200],[600,1200,1400]]);
 assert.match(lines(r.ass)[0],/\\org\(400,800\)\\bord0\\shad2\\an4\\move\(740,755,600,800,0,200\)\\fry12\\fax-0.05/);assert.match(lines(r.ass)[1],/\\move\(600,800,-50,800,0,300\).*\\fry-10\\fax0.5\\fscx60\\fscy60\\alpha&H99&/);
 assert.match(r.ass,/Style: Style3DFlip,fixture,45,.*0,0,0,0,100,100,0,0,1,0,1,4,/);assert.equal(r.details[6].frontEndCs,1450);assert.equal(r.details[6].backEndCs,1650);
});

test('3D不足一组时每行按end补1.5秒再留2秒，倍速不改变补时和动画毫秒',()=>{
 const r=toMotionTemplateAss(input(2),360,640,'3d_flip','fixture',{speed:2,offsetY:-200});assert.deepEqual(r.details.map(d=>[d.startCs,d.frontEndCs,d.backEndCs]),[[0,200,400],[100,300,500]]);assert.match(lines(r.ass)[0],/\\org\(60,593\).*\\move\(117,566,98,593,0,200\)/);assert.equal(r.shift,-119);
});

test('紫色滑块字宽区分中文、ASCII、标点和空格；空格消耗时间但没有色块',()=>{
 assert.equal(purpleCharWidth('甲',50),52.5);assert.equal(purpleCharWidth('A',50),30);assert.equal(purpleCharWidth('。',50),22.5);assert.equal(purpleCharWidth(' ',50),17.5);
 const rows=[{start:0,end:1,text:'甲 A。'}],r=toMotionTemplateAss(rows,1920,1080,'purple_slide','fixture');assert.equal(r.eventCount,6);assert.equal(r.details[0].stepCs,5);const e=lines(r.ass);assert.match(e[0],/0:00:00.00,0:00:01.00,Txt.*\\pos\(888,778\).*m 0 0 l 72 0 l 72 70 l 0 70/);assert.match(e[2],/0:00:00.10,0:00:01.00,Txt/);assert.match(e[3],/Dialogue: 1,.*\\pos\(983,840\).*\}A$/);
});

test('紫色滑块极短行只绘可获得1厘秒位置的字，不越过结束时间',()=>{
 const r=toMotionTemplateAss([{start:0,end:.01,text:'甲乙丙丁'}],1920,1080,'purple_slide','fixture');assert.equal(r.eventCount,2);assert.equal(r.details[0].characters,1);assert.equal(r.details[0].stepCs,1);
});

test('红黄七句各自坐标和跨两句保留，第二句每24ms逐字，最后缩入140%',()=>{
 const r=toMotionTemplateAss(input(),1920,1080,'red_yellow','fixture'),e=lines(r.ass);assert.equal(r.eventCount,7);assert.deepEqual(r.details.map(d=>d.endCs),[100,300,700,700,1300,1100,1300]);
 assert.match(e[1],/\\t\(24,74,1.2,/);assert.match(e[2],/\\pos\(930,810\)/);assert.match(e[3],/\\pos\(1030,860\).*\\bord1.*\\fscx60/);assert.match(e[5],/\\pos\(720,770\)\\1c&H0000FF&.*\\t\(0,240,1.4,/);assert.match(e[6],/\\pos\(1200,910\).*\\fscx140/);
});

test('红蓝五句红蓝黄交替、前两句逐字缩入，第一第四句延后，下移落位独立',()=>{
 const r=toMotionTemplateAss(input(5),1920,1080,'red_blue_science','fixture'),e=lines(r.ass);assert.deepEqual(r.details.map(d=>d.endCs),[300,300,500,900,900]);assert.match(e[0],/\\pos\(960,840\).*\\1c&H0000FF&.*\\t\(35,95,1.2,/);assert.match(e[1],/\\pos\(960,900\).*\\1c&HFF6600&/);assert.match(e[2],/\\1c&H00D7FF&\\fad\(200,0\)/);assert.match(e[4],/\\move\(960,805,960,840,0,260\)/);
});

test('六模板关键词只标注原文命中范围，文本ASS注入被转义，取消有效',()=>{
 for(const id of motionSubtitleIds){const rows=[{start:0,end:1,text:'甲乙甲',auxiliary:{sourceText:'甲乙甲',keywords:['甲']}}],r=toMotionTemplateAss(rows,1920,1080,id,'fixture',{keywords:true});assert.ok(r.ass.includes('\\c&H6CCBF3&')||r.ass.includes('\\1c&H6CCBF3&'),id);assert.ok(r.ass.includes('乙'));}
 const r=toMotionTemplateAss([{start:0,end:1,text:'{\\pos(0,0)}文字'}],1920,1080,'red_yellow','fixture');assert.ok(r.ass.includes('｛＼pos(0,0)｝文字'));const controller=new AbortController();controller.abort();assert.throws(()=>toMotionTemplateAss(input(),1920,1080,'3d_flip','fixture',{signal:controller.signal}),/abort/i);assert.throws(()=>toMotionTemplateAss(input(),1920,1080,'simple_yellow_white','fixture'),/没有滚动/);
});

test('六模板升级后旧版本不复用，预览完整覆盖不同循环',()=>{
 for(const id of motionSubtitleIds){const draft={edit:{subtitlesEnabled:true,subtitleMode:'template',subtitleTemplate:id}},asset={renderedSubtitleTemplate:{templateId:id,engineVersion:1}};assert.equal(subtitleOutputCurrent(draft,asset),false);asset.renderedSubtitleTemplate.engineVersion=2;assert.equal(subtitleOutputCurrent(draft,asset),true);}
 assert.equal(subtitlePreviewCount('3d_flip'),9);assert.equal(subtitlePreviewCount('red_yellow'),7);assert.equal(subtitlePreviewCount('red_blue_science'),5);assert.equal(subtitlePreviewCount('scrolling_4lines'),6);
});
