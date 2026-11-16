const test=require('node:test'),assert=require('node:assert/strict');
const modules=Promise.all([import('../server/title-model.mjs'),import('../server/title-layout.mjs')]);
async function fixture(id,width,height,patch={}){const [model,layout]=await modules,design={...model.titleDesign({}),mode:'template',templateId:id,...patch};return {model,layout,snapshot:model.titleSnapshot({title:'主标题',subtitle:'副标题',titleDesign:design},width,height)};}
test('模板采用横向1920和纵向1080参考系，主副字重和行距独立',async()=>{
 const {layout,snapshot}=await fixture('title_yellow_ximai_stroke',1920,1080),before=JSON.stringify(snapshot),result=layout.templateTitleLayout(snapshot);
 assert.equal(snapshot.version,2);assert.deepEqual(result.lines.map(l=>[l.x,l.y,l.fontSize,l.fontWeight]),[[960,100,70,900],[960,160,65,700]]);assert.equal(JSON.stringify(snapshot),before);
 const portrait=await fixture('title_yellow_ximai_stroke',360,640),lines=layout.templateTitleLayout(portrait.snapshot).lines;
 assert.deepEqual(lines.map(l=>[l.x,l.y,l.fontSize]),[[180,59.26,41.48],[180,94.81,38.52]]);
});
test('错位模板在横竖屏中两行朝相反方向移动，不使用共享横移',async()=>{
 for(const [width,height,expected]of [[1920,1080,[[760,100],[1160,180]]],[640,360,[[253.33,33.33],[386.67,60]]],[360,640,[[142.5,59.26],[217.5,106.67]]]]){
  const {layout,snapshot}=await fixture('title_orange_yellow_xiehei_stroke',width,height,{offsetX:500});
  const actual=layout.templateTitleLayout(snapshot).lines.map(l=>[l.x,l.y]);
  actual.forEach((point,i)=>point.forEach((value,j)=>assert(Math.abs(value-expected[i][j])<1e-9)));
 }
});
test('遮罩覆盖全宽且按独立行高度计算，只有副标题也保留其原行位置',async()=>{
 const {layout,snapshot}=await fixture('title_orange_white_serif_shadow',1920,1080);
 assert.deepEqual(layout.templateTitleLayout(snapshot).mask,{x:0,y:25,width:1920,height:187.5,color:'rgba(0,0,0,0.24)'});
 snapshot.main='';const single=layout.templateTitleLayout(snapshot);assert.equal(single.lines.length,1);assert.equal(single.lines[0].y,160);assert.equal(single.lines[0].fontSize,65);assert.equal(single.mask.y,107.5);assert.equal(single.mask.height,105);
});
test('模板预设自己的顶部偏移生效，移动时保留两行距离和模板字号',async()=>{
 const {layout,snapshot}=await fixture('title_orange_white_stroke',1920,1080,{offsetY:300});snapshot.style.fontSize=160;
 assert.deepEqual(layout.templateTitleLayout(snapshot).lines.map(l=>[l.y,l.fontSize]),[[412,70],[492,65]]);
 const [,pl]=await modules;const nativeTop=pl.templateTitlePointerOffset(700,{top:100,height:540},112);assert.equal(nativeTop,824);
});
test('模板按下绝对定位与CSS边界映射，忽略横坐标并拒绝无效媒体框',async()=>{
 const [,layout]=await modules;
 assert.equal(layout.templateTitlePointerOffset(250,{top:100,height:500},100),224);
 assert.equal(layout.templateTitlePointerOffset(-100,{top:100,height:500},100),-48);
 assert.equal(layout.templateTitlePointerOffset(10000,{top:100,height:500},100),824);
 assert.equal(layout.templateTitlePointerOffset(0,{top:0,height:0},100),null);
 assert.equal(layout.templateTitlePointerOffset(NaN,{top:0,height:500},100),null);
});
test('模板不因长文本自动换行，保留单副行和CSS空白折叠',async()=>{
 const {layout,snapshot}=await fixture('title_blue_wendao_stroke',1920,1080);snapshot.main='甲'.repeat(200)+'\n  乙';snapshot.sub='';
 const result=layout.templateTitleLayout(snapshot);assert.equal(result.lines.length,1);assert(result.lines[0].text.endsWith('甲 乙'));assert.equal(result.lines[0].fontSize,70);assert.equal(result.lines[0].fontWeight,900);
});
