const test=require('node:test'),assert=require('node:assert/strict');
const {toYellowTemplateAss,yellowSubtitleIds,yellowMetrics,yellowCharWidth}=require('../server/yellow-template-subtitles.cjs');
const {subtitlePreviewCount,subtitleEngineVersion,subtitleOutputCurrent}=require('../server/subtitle-output.mjs');
const rows=(count=4)=>Array.from({length:count},(_,i)=>({start:i*2,end:i*2+1,text:'甲乙丙'}));
const lines=r=>r.ass.split('\n').filter(s=>s.startsWith('Dialogue:'));

test('黄白裂开四句周期：逐字定位、白字超调、上句分两层clip和上下移入',()=>{
 const r=toYellowTemplateAss(rows(),1920,1080,'yellow_white_split','fixture'),e=lines(r);assert.equal(r.eventCount,8);
 assert.match(e[0],/\\fs50\\an2\\pos\(910,900\).*\\t\(0,216,1.0,/);assert.match(e[1],/\\pos\(960,900\).*\\t\(216,432,1.0,/);assert.match(e[2],/\\pos\(1010,900\).*\\t\(432,648,1.0,/);
 assert.match(e[3],/^Dialogue: 1,.*\\fscx70\\fscy70\\t\(0,180,1.8,\\fscx170\\fscy170\)\\t\(180,340,1.6,/);
 assert.match(e[4],/\\pos\(950,886\)\\clip\(100,746,1800,886\)/);assert.match(e[5],/\\pos\(970,914\)\\clip\(120,914,1820,1054\)/);
 assert.match(e[6],/\\move\(960,850,960,900,0,260\)\\fscx70/);assert.match(e[7],/\\move\(960,950,960,900,0,260\)\\fscx150/);
});

test('裂开裁剪高度280及上下偏移14、左右10保持固定像素，offset同步移动clip和pos',()=>{
 const r=toYellowTemplateAss(rows(2),360,640,'yellow_white_split','fixture',{offsetY:200}),e=lines(r);assert.equal(r.shift,119);
 assert.match(e[4],/\\pos\(170,400\)\\clip\(11,260,330,400\)/);assert.match(e[5],/\\pos\(190,428\)\\clip\(31,428,350,568\)/);
});

test('裂开前一句长文已缩小，但拆开重现时按原版去掉之前的字号标签',()=>{
 const input=rows(2);input[0].text='长'.repeat(100);const r=toYellowTemplateAss(input,1920,1080,'yellow_white_split','fixture'),e=lines(r);assert.equal(r.details[0].fittedFontSize,38);assert.ok(e[0].includes('\\fs38'));assert.equal(e.at(-1).includes('\\fs'),false);
});

test('黄白斜体十句独立位置、字体和跨句延时',()=>{
 const r=toYellowTemplateAss(rows(10),1920,1080,'yellow_white_italic','fixture'),e=lines(r);assert.equal(e.length,10);assert.match(r.ass,/Style: Default,fixture,50,.*,-1,-1,/);
 assert.deepEqual(r.details.map(d=>d.endCs),[100,500,500,700,1300,1300,1300,1500,1900,1900]);
 assert.match(e[1],/\\move\(-500,770,960,770,0,300\)/);assert.match(e[2],/\\fs60\\move\(2420,830,960,830,0,300\)/);
 assert.match(e[4],/\\pos\(960,740\)\\fscx150/);assert.match(e[5],/\\pos\(960,800\)\\fscx150/);assert.match(e[6],/\\pos\(960,860\)\\fscx150/);assert.match(e[8],/\\move\(960,1200,960,770,0,300\)/);
});

test('斜体不足三行仍延到现存下一条，安全宽按每句最大缩放且长字下限70%',()=>{
 const input=rows(6);input[0].text='长'.repeat(100);input[2].text='长'.repeat(100);const r=toYellowTemplateAss(input,360,640,'yellow_white_italic','fixture'),e=lines(r);assert.equal(r.details[4].endCs,1100);assert.equal(r.details[0].fittedFontSize,21);assert.equal(r.details[2].fittedFontSize,23);
 assert.match(e[2],/\\fs33\\move\(454,492,180,492,0,300\).*\{\\fs23\}/);
 assert.deepEqual(yellowMetrics('yellow_white_italic',5,1920,1080),{fontSize:50,maxChars:23,minimum:.7,centerX:960});
});

test('书法第一句白黄两半、固定60像素clip与130%模糊入场',()=>{
 const r=toYellowTemplateAss(rows(1),360,640,'yellow_white_calligraphy','fixture',{offsetY:-200}),e=lines(r);assert.equal(e.length,2);assert.match(r.ass,/Style: Default,fixture,30,.*1,1,0,2,/);
 assert.match(e[0],/\\fscx130\\fscy130\\blur6.*\\bord2\\shad0\\an5\\1c&HFFFFFF&\\pos\(180,629\)\\clip\(0,569,360,629\)/);assert.match(e[1],/\\1c&H00D7FF&.*\\clip\(0,629,360,689\)/);
});

test('书法第二句逐步增长且延下一end，第三句双层渐色加光晕',()=>{
 const r=toYellowTemplateAss(rows(3),1920,1080,'yellow_white_calligraphy','fixture'),e=lines(r);assert.equal(r.details[1].endCs,500);assert.equal(r.details[1].step,5);
 const second=e.filter(s=>s.includes('\\pos(960,740)'));assert.equal(second.length,4);assert.match(second[0],/0:00:02.00,0:00:02.05,.*\}甲$/);assert.match(second.at(-1),/0:00:02.15,0:00:05.00,.*\}甲乙丙$/);
 const glow=e.filter(s=>s.startsWith('Dialogue: 1,')&&s.includes('\\blur8'));assert.equal(glow.length,4);assert.ok(glow.every(s=>s.includes('\\alpha&H80&')));
});

test('书法第四句保留move后pos标签顺序，逐段地板厘秒与模糊拖影',()=>{
 const r=toYellowTemplateAss(rows(),1920,1080,'yellow_white_calligraphy','fixture'),e=lines(r).filter(s=>s.includes('0:00:06.'));assert.equal(r.details[3].step,200);assert.ok(e.some(s=>s.includes('\\move(1020,860,960,860,0,200)')&&s.includes('\\pos(960,860)')));assert.ok(e.some(s=>s.startsWith('Dialogue: 1,')&&s.includes('\\blur14\\alpha&HAA&')&&s.includes('\\move(1040,860,960,860,0,200)')));
 assert.ok(e.some(s=>s.includes('0:00:06.60,0:00:07.00,')&&s.endsWith('甲乙丙')));
});

test('跳动六句全字符首时可见、固定负20间距与纵向100至135至100动画',()=>{
 const r=toYellowTemplateAss(rows(6),1920,1080,'yellow_white_bounce','fixture'),e=lines(r);assert.equal(e.length,18);assert.deepEqual(r.details.map(d=>d.endCs),[100,500,500,900,900,1100]);
 assert.match(e[0],/\\pos\(915,900\)\\fs65\\fscx100\\fscy100\\t\(0,128,1.4,\\fscy135\)\\t\(128,233,1.2,\\fscy100\)/);assert.match(e[1],/\\pos\(960,900\).*\\t\(233,361,1.4,/);assert.match(e[2],/\\pos\(1005,900\)/);assert.equal(e[0].includes('\\alpha'),false);
 assert.match(e[3],/\\pos\(555,850\)/);assert.match(e[6],/\\pos\(955,950\)/);assert.match(e[12],/\\fs90/);
});

test('跳动第五句拟合值按原版再次除65乘大字号，不能简化为before字号',()=>{
 const input=rows(5);input[4].text='长'.repeat(100);const r=toYellowTemplateAss(input,1920,1080,'yellow_white_bounce','fixture');assert.equal(r.details[4].fittedFontSize,63);assert.match(lines(r).at(-1),/\\fs87/);
 const small=toYellowTemplateAss(rows(1),360,640,'yellow_white_bounce','fixture');assert.match(lines(small)[0],/\\pos\(161,533\)\\fs39/);assert.match(lines(small)[2],/\\pos\(199,533\)\\fs39/);
});

test('黄底白字两份borderStyle，增长阶段带光标，完整保留阶段无光标',()=>{
 const r=toYellowTemplateAss(rows(1),1920,1080,'yellow_box_white','fixture'),e=lines(r);assert.equal(r.eventCount,8);assert.match(r.ass,/Style: TypeBox,fixture,50,.*0,0,3,8,0,2,10,10,20,1/);assert.match(r.ass,/Style: TypeText,fixture,50,.*0,0,1,0,1,2,10,10,20,1/);
 assert.match(e[0],/0:00:00.00,0:00:00.05,TypeBox.*\\pos\(960,840\).*甲\|$/);assert.ok(e[5].endsWith('丙|'));assert.equal(e[6].endsWith('|'),false);assert.match(e[6],/0:00:00.15,0:00:01.00,TypeBox/);
});

test('短至1厘秒不超出行尾，空列表不生事件，变速改时段不缩固定动画',()=>{
 for(const id of yellowSubtitleIds){const r=toYellowTemplateAss([{start:0,end:.01,text:'甲乙丙'}],1920,1080,id,'fixture');assert.ok(lines(r).every(s=>!s.includes(',0:00:00.02,')));assert.equal(toYellowTemplateAss([],1920,1080,id,'fixture').eventCount,0);}
 const r=toYellowTemplateAss(rows(10),1920,1080,'yellow_white_italic','fixture',{speed:2});assert.equal(r.details[2].startCs,200);assert.ok(r.ass.includes(',0,300)'));
});

test('字宽、关键词多次命中、ASS注入转义、输入不变与主动取消',()=>{
 assert.equal(yellowCharWidth('A',50),27.5);assert.equal(yellowCharWidth('。',50),22.5);assert.equal(yellowCharWidth(' ',50),17.5);
 const input=[{start:0,end:1,text:'甲乙甲',auxiliary:{sourceText:'甲乙甲',keywords:['甲']}}],before=JSON.stringify(input);for(const id of ['yellow_white_bounce','yellow_box_white']){const r=toYellowTemplateAss(input,1920,1080,id,'fixture',{keywords:true});assert.ok(r.ass.includes('\\c&H6CCBF3&'));assert.ok(r.ass.includes('\\c&HFFFFFF&')||r.ass.includes('\\c&H00D7FF&'));}assert.equal(JSON.stringify(input),before);
 for(const id of yellowSubtitleIds){const r=toYellowTemplateAss([{start:0,end:1,text:'{\\pos(0,0)}文字'}],1920,1080,id,'fixture');assert.equal(r.ass.includes('{\\pos(0,0)}'),false);const control=new AbortController();control.abort();assert.throws(()=>toYellowTemplateAss(rows(),1920,1080,id,'fixture',{signal:control.signal}),/abort/i);}
 assert.throws(()=>toYellowTemplateAss(rows(),1920,1080,'simple_yellow_white','fixture'),/没有黄白/);
});

test('新五模板升级后旧产物需重剪，预览覆盖4/10/4/6/4完整句周期',()=>{
 for(const [id,count]of yellowSubtitleIds.map((id,i)=>[id,[4,10,4,6,4][i]])){assert.equal(subtitleEngineVersion(id),2);assert.equal(subtitlePreviewCount(id),count);const draft={edit:{subtitlesEnabled:true,subtitleMode:'template',subtitleTemplate:id}},asset={renderedSubtitleTemplate:{templateId:id,engineVersion:1}};assert.equal(subtitleOutputCurrent(draft,asset),false);asset.renderedSubtitleTemplate.engineVersion=2;assert.equal(subtitleOutputCurrent(draft,asset),true);}
});
