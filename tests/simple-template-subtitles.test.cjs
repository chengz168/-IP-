const test=require('node:test'),assert=require('node:assert/strict');
const {toSimpleTemplateAss,cycleMetrics}=require('../server/simple-template-subtitles.cjs');
const {subtitleOutputCurrent}=require('../server/subtitle-output.mjs');
const rows=()=>Array.from({length:12},(_,i)=>({start:i+0.1,end:i+0.9,text:'字幕'}));
const events=ass=>ass.split('\n').filter(line=>line.startsWith('Dialogue:'));

test('黄白六句原生坐标与跨句延时保持独立，第五句使用专属字号',()=>{
 const input=rows(),before=JSON.stringify(input),r=toSimpleTemplateAss(input,1920,1080,'simple_yellow_white','fixture');
 assert.deepEqual(r.details.slice(0,6).map(d=>[d.start,d.end]),[[.1,.9],[1.1,2.9],[2.1,2.9],[3.1,4.9],[4.1,4.9],[5.1,5.9]]);
 const lines=events(r.ass);assert.match(lines[0],/\\pos\(960,840\)\\fscx150\\fscy150/);assert.match(lines[1],/\\pos\(600,850\)/);assert.match(lines[2],/\\pos\(950,900\)/);
 assert.match(lines[3],/\\move\(960,800,960,850,0,300\)\\fad\(300,0\)/);assert.match(lines[4],/\\move\(960,960,960,900,0,300\)\\fs60/);assert.match(lines[5],/\\pos\(960,840\)\\fscx50\\fscy50/);
 assert.match(r.ass,/WrapStyle: 0/);assert.match(r.ass,/Style: Default,fixture,50,.*,-1,0,0,0,100,100,0,0,1,0,0,5,10,10,10,1/);assert.equal(JSON.stringify(input),before);
});

test('竖屏逐轴取整，正偏移上移，move两个端点同时移动',()=>{
 const r=toSimpleTemplateAss(rows(),360,640,'simple_yellow_white','fixture',{offsetY:200});assert.equal(r.shift,119);
 assert.match(events(r.ass)[0],/\\pos\(180,379\)/);assert.match(events(r.ass)[1],/\\pos\(143,385\)/);
 assert.match(events(r.ass)[3],/\\move\(180,355,180,385,0,300\)/);assert.match(events(r.ass)[4],/\\fs33/);
 const down=toSimpleTemplateAss(rows(),360,640,'simple_yellow_white','fixture',{offsetY:-200});assert.equal(down.shift,-119);assert.match(events(down.ass)[0],/\\pos\(180,617\)/);
});

test('蓝白固定种子跨循环继续，第一句保留原契约pos与附加move的顺序',()=>{
 const r=toSimpleTemplateAss(rows(),1920,1080,'simple_blue_white','fixture');assert.deepEqual(r.details.map(d=>d.animation),['slide','fade','fade','fade','fade','slide','pop','pop','pop','slide','pop','pop']);
 assert.match(events(r.ass)[0],/\\pos\(960,900\).*\\move\(1040,900,860,900,0,220\)/);assert.match(events(r.ass)[3],/\\move\(960,800,900,850,0,300\)/);
 assert.match(events(r.ass)[5],/\\fscx50.*\\move\(1040,900,960,900,0,220\)/);assert.match(events(r.ass)[9],/\\fad\(300,0\)\\fscx120/);
 assert.equal(toSimpleTemplateAss(rows(),1920,1080,'simple_blue_white','fixture').ass,r.ass);
});

test('棕白六句含26ms逐字与独立闪光标，字号拟合在每字生效',()=>{
 const input=rows().slice(0,6);input[4].text='认真';input[5].text='完成';const r=toSimpleTemplateAss(input,1920,1080,'simple_brown_white','fixture'),lines=events(r.ass);
 assert.deepEqual(r.details.map(d=>d.animation),['fade','pop','slide','tilt','type','cursor']);
 assert.match(lines[2],/\\pos\(1000,810\)\\move\(1080,810,1000,810,0,220\)/);assert.match(lines[3],/\\move\(960,700,960,720,0,300\).*\\frz3/);
 assert.match(lines[4],/\\t\(0,55,1.2,\\alpha&H00&\)\}认\{.*\\t\(26,81,1.2,\\alpha&H00&\)\}真/);assert.match(lines[5],/\\t\(420,560,\\alpha&H00&\)\}\|$/);
 input[4].text='长'.repeat(100);const long=events(toSimpleTemplateAss(input,1920,1080,'simple_brown_white','fixture').ass)[4];assert.match(long,/\\fs35\}长/);assert.equal((long.match(/\\fs35/g)||[]).length,100);
});

test('长文本采用候选运动位置计算安全宽，字号下限70%，不主动增加分行',()=>{
 assert.deepEqual(cycleMetrics('simple_yellow_white',1,1920,1080),{fontSize:50,safeWidth:1146,maxChars:22});
 assert.deepEqual(cycleMetrics('simple_blue_white',1,1920,1080),{fontSize:50,safeWidth:1013,maxChars:20});
 assert.deepEqual(cycleMetrics('simple_brown_white',2,1920,1080),{fontSize:50,safeWidth:833,maxChars:16});
 const input=[{start:0,end:1,text:'长'.repeat(100)}],r=toSimpleTemplateAss(input,1920,1080,'simple_yellow_white','fixture');assert.equal(r.details[0].fittedFontSize,35);assert.equal(r.ass.includes('\\N'),false);
 const square=toSimpleTemplateAss(rows(),1080,1080,'simple_yellow_white','fixture');assert.match(events(square.ass)[1],/\\pos\(338,850\)/);
});

test('变速改变事件时段，保留固定300ms动画；最后一行无下一行不延长',()=>{
 const input=rows().slice(0,2),r=toSimpleTemplateAss(input,1920,1080,'simple_yellow_white','fixture',{speed:2});assert.deepEqual(r.details.map(d=>[d.start,d.end]),[[.05,.45],[.55,.95]]);assert.match(r.ass,/\\t\(0,300,1.5,/);assert.match(events(r.ass)[1],/0:00:00.55,0:00:00.95/);
});

test('ASS用户指令只显示为文字，主动取消阻止生成，不影响传入文案',()=>{
 const input=[{start:0,end:1,text:'{\\pos(0,0)}文字\n第二行'}],r=toSimpleTemplateAss(input,1920,1080,'simple_yellow_white','fixture');assert.ok(r.ass.includes('｛＼pos(0,0)｝文字\\N第二行'));assert.equal(r.ass.includes('{\\pos(0,0)}'),false);
 const controller=new AbortController();controller.abort();assert.throws(()=>toSimpleTemplateAss(input,1920,1080,'simple_yellow_white','fixture',{signal:controller.signal}),/abort/i);
 assert.throws(()=>toSimpleTemplateAss(input,1920,1080,'other','fixture'),/没有简约/);
});

test('已升级模板旧产物失效，不修改草稿与历史资产，自定义模式不误失效',()=>{
 const draft={edit:{subtitlesEnabled:true,subtitleMode:'template',subtitleTemplate:'simple_blue_white'}},asset={renderedSubtitleTemplate:{templateId:'simple_blue_white',engineVersion:1}},before=JSON.stringify({draft,asset});
 assert.equal(subtitleOutputCurrent(draft,asset),false);assert.equal(JSON.stringify({draft,asset}),before);asset.renderedSubtitleTemplate.engineVersion=2;assert.equal(subtitleOutputCurrent(draft,asset),true);
 asset.renderedSubtitleTemplate.templateId='simple_yellow_white';assert.equal(subtitleOutputCurrent(draft,asset),false);draft.edit.subtitleTemplate='cute_pink';assert.equal(subtitleOutputCurrent(draft,asset),false);draft.edit.subtitleMode='custom';assert.equal(subtitleOutputCurrent(draft,asset),true);draft.edit.subtitleMode='template';draft.edit.subtitleTemplate='simple_blue_white';draft.edit.subtitlesEnabled=false;assert.equal(subtitleOutputCurrent(draft,asset),true);
});
