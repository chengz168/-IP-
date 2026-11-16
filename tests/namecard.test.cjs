const test=require('node:test'),assert=require('node:assert/strict');
const {namecardDesign,namecardSnapshot,validateNamecard,namecardRanges}=require('../server/namecard-model.mjs');
const {editSubtitlePreview}=require('../src/edit-subtitle-preview.mjs');
test('名片默认读取不修改旧任务，空文案保留原版示意文字，多行简介清理空行',()=>{
 const edit={cardName:'',cardDescription:'\n  实用方法  \n\n 每日分享\n'},before=JSON.stringify(edit),snapshot=namecardSnapshot(edit,360,640);
 assert.equal(JSON.stringify(edit),before);assert.equal(snapshot.name,'人物称呼');assert.deepEqual(snapshot.lines,['实用方法','每日分享']);assert.equal(snapshot.design.offsetX,64);assert.equal(snapshot.design.displayMode,'duration');assert.equal(snapshot.design.duration,5);assert.equal(namecardDesign(edit).fontSize,28);
});
test('名片拒绝越界、非有限数、错误模式颜色和超长内容，不在后端静默修改',()=>{
 for(const [key,[min,max]]of Object.entries(namecardRanges))for(const value of [NaN,Infinity,min-1,max+1])assert.throws(()=>validateNamecard({cardDesign:{[key]:value}}),/范围/);
 for(const patch of [{displayMode:'other'},{version:2},{textColor:'red'},{nameBold:1},{fontFamily:'a\nb'}])assert.throws(()=>validateNamecard({cardDesign:patch}));
 assert.throws(()=>validateNamecard({cardName:'称'.repeat(501)}),/过长/);assert.throws(()=>namecardSnapshot({},0,1920),/尺寸/);
});
test('字幕模板预览保留上移参数和关键词能力，模板缺失明确失败',()=>{
 const edit={subtitleMode:'template',subtitleTemplate:'simple_yellow_white',subtitleTemplateY:1000,subtitleKeywords:true},c=editSubtitlePreview(edit);assert.equal(c.positionY,1000);assert.equal(typeof c.highlight,'boolean');assert.throws(()=>editSubtitlePreview({...edit,subtitleTemplate:'missing'}),/不存在/);
});
test('自定义字幕预览按真实源高换算底部像素，字体样式和透明度保留',()=>{
 const edit={subtitleCustom:{fontSize:50,bottomMargin:100,color:'#ff0000',opacity:30,bold:true,italic:true,underline:true,outlineEnabled:true,backgroundEnabled:false}},s=editSubtitlePreview(edit,{height:640});assert.equal(s.opacity,.3);assert.equal(s.positionY,1920*(1-100/640)-50*1920/1080*.58);assert.deepEqual(s.fontStyles,['bold','italic','underline']);assert.equal(s.backgroundType,'none');
});
