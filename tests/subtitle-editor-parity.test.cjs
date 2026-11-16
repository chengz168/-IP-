const {test}=require('node:test');
const assert=require('node:assert/strict');
const {toCustomAss}=require('../server/custom-subtitles.cjs');
const font={id:'font-0123456789abcdef0123',family:'Microsoft YaHei'};

test('新版八预设使用核实的字号、行高和间距，保留底距和方向；旧版不变',async()=>{
 const {subtitleDefaults,subtitlePresets,presetStyle}=await import('../server/subtitle-style.mjs');
 const current={...subtitleDefaults,version:2,fontId:font.id,fontSize:80,bottomMargin:350,referenceHeight:1080,lineHeight:1.2,presetId:'',bold:true};
 const rows=subtitlePresets.map(p=>presetStyle(p.id,current,font));
 assert.deepEqual(rows.map(s=>s.lineHeight),[1.2,1.2,1.2,1.2,1.4,1.1,1.3,1.2]);
 assert.deepEqual(rows.map(s=>s.letterSpacing),[0,0,0,0,1,.5,0,1]);
 for(const s of rows){assert.equal(s.fontSize,50);assert.equal(s.bottomMargin,350);assert.equal(s.referenceHeight,1080);assert.equal(s.bold,false);assert.equal(s.shadowOpacity,80);}
 assert.equal(presetStyle('simple',{...current,version:1},font).fontSize,80);
});

test('旧任务编辑仅转换临时副本，新版预览位置不再依赖源像素尺寸',async()=>{
 const {subtitleDefaults,toEditorSubtitle,validateSubtitleStyle}=await import('../server/subtitle-style.mjs');
 const {editSubtitlePreview}=await import('../src/edit-subtitle-preview.mjs');
 const old={...subtitleDefaults,fontId:font.id,fontSize:200,bottomMargin:100},before=JSON.stringify(old),next=toEditorSubtitle(old,{height:640});
 assert.equal(JSON.stringify(old),before);assert.equal(next.fontSize,96);assert.equal(next.version,2);validateSubtitleStyle(next);
 const edit={subtitleCustom:{...next,bottomMargin:420,referenceHeight:1920,fontSize:50}};
 assert.equal(editSubtitlePreview(edit,{height:640}).positionY,1500);assert.equal(editSubtitlePreview(edit,{height:1920}).positionY,1500);
 assert.throws(()=>validateSubtitleStyle({...next,lineHeight:NaN}),/参数/);
});

test('模板偏移正数上移、切换模板复用偏移，旧绝对位置保持只读兼容',async()=>{
 const {subtitlePosition,subtitleOffset}=await import('../server/subtitle-position.mjs');
 const a={config:{positionY:1500}},b={config:{positionY:1320}};
 assert.equal(subtitlePosition({subtitleOffsetY:200},a),1138);assert.equal(subtitlePosition({subtitleOffsetY:200},b),1138);
 assert.equal(subtitlePosition({subtitleOffsetY:-200},a),1849);assert.equal(subtitlePosition({subtitleOffsetY:600},a),427);
 const old={subtitleTemplateY:100};assert.equal(subtitleOffset(old,a),783.75);assert.equal(subtitlePosition(old,a),100);assert.deepEqual(old,{subtitleTemplateY:100});
 assert.throws(()=>subtitlePosition({subtitleOffsetY:NaN},a),/无效/);assert.throws(()=>subtitlePosition({subtitleOffsetY:601},a),/偏移/);
});

test('新版ASS在两分辨率使用相同比例位置和行高，旧版仍使用底部像素',async()=>{
 const {subtitleDefaults}=await import('../server/subtitle-style.mjs');
 const s={...subtitleDefaults,version:2,fontId:font.id,lineHeight:1.4,presetId:'',backgroundEnabled:true};
 const rows=[{start:1,end:3,text:'第一行\n第二行'}],small=await toCustomAss(rows,360,640,s,{speed:2}),large=await toCustomAss(rows,1080,1920,s);
 assert.match(small,/\\an5\\pos\(180\.000,479\.259\)/);assert.match(small,/\\an5\\pos\(180\.000,520\.741\)/);
 assert.match(large,/\\an5\\pos\(540\.000,1437\.778\)/);assert.match(small,/0:00:00.50,0:00:01.50/);
 const legacy=await toCustomAss([{start:0,end:1,text:'旧字幕'}],360,640,{...subtitleDefaults,fontId:font.id,bottomMargin:100});assert.ok(!legacy.includes('\\pos('));
});

test('原版弹窗示意与实际视频区采用各自核实的坐标，背景和字形参数完整',async()=>{
 const {subtitleDefaults}=await import('../server/subtitle-style.mjs'),{subtitleEditorPreview}=await import('../src/subtitle-editor-preview.mjs');
 const s={...subtitleDefaults,version:2,lineHeight:1.4,backgroundEnabled:true,bold:true,shadowEnabled:true,outlineEnabled:true};
 const css=subtitleEditorPreview(s,'真实字体别名');assert.equal(css.bottom,'105px');assert.equal(css.fontSize,'22.2px');assert.equal(css.fontWeight,'bold');assert.equal(css.lineHeight,1.4);assert.equal(css.padding,'2px 4px');assert.ok(css.textShadow.includes('#000000'));
});

test('模板主编辑预览保留自定义字形，切模板只替换位置，不显示关键词高亮',async()=>{
 const {editSubtitlePreview}=await import('../src/edit-subtitle-preview.mjs');
 const custom={version:2,fontId:font.id,fontFamily:font.family,fontSize:60,bold:true,italic:true,color:'#AABBCC',opacity:70,backgroundEnabled:true,backgroundColor:'#000000',backgroundOpacity:30,bottomMargin:420,referenceHeight:1920,lineHeight:1.4};
 const edit={subtitleMode:'template',subtitleTemplate:'yellow_white_split',subtitleOffsetY:200,subtitleKeywords:true,subtitleCustom:custom},before=JSON.stringify(edit);
 const a=editSubtitlePreview(edit),b=editSubtitlePreview({...edit,subtitleTemplate:'red_white_bilingual'});
 assert.equal(a.fontId,font.id);assert.equal(a.fontFamily,font.family);assert.equal(a.color,'#AABBCC');assert.equal(a.opacity,.7);assert.equal(a.positionY,1138);assert.equal(a.highlight,false);
 assert.equal(a.fontSize,b.fontSize);assert.equal(a.color,b.color);assert.equal(a.backgroundOpacity,b.backgroundOpacity);assert.equal(a.positionY,b.positionY);assert.equal(JSON.stringify(edit),before);
});
