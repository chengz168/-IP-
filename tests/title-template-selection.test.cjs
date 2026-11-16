const test=require('node:test'),assert=require('node:assert/strict');
const model=import('../server/title-model.mjs');
test('连续切换模板继承原版未声明的描边、阴影与斜体开关',async()=>{
 const m=await model,pick=name=>m.titleTemplates.find(t=>t.name===name),edit={title:'主标题',subtitle:'副标题',titleDesign:m.titleDesign({})};
 edit.titleDesign=m.selectTitleTemplate(edit,pick('黄白行楷'));edit.titleDesign=m.selectTitleTemplate(edit,pick('橙白粗黑宋'));
 let s=m.titleSnapshot(edit,360,640);assert.equal(s.style.stroke.enabled,false);assert.equal(s.style.shadow.enabled,true);assert.equal(s.style.top,112);
 edit.titleDesign=m.selectTitleTemplate(edit,pick('橙黄错位'));edit.titleDesign=m.selectTitleTemplate(edit,pick('橙白粗黑宋'));
 s=m.titleSnapshot(edit,360,640);assert.equal(s.style.stroke.enabled,true);assert.equal(s.style.shadow.enabled,false);assert.equal(s.style.italic,true);
 const restored=JSON.parse(JSON.stringify(edit));assert.deepEqual(m.titleSnapshot(restored,360,640),s);
});
test('自定义切入模板保留缺省设置，模板声明的设置覆盖当前值',async()=>{
 const m=await model,edit={title:'继承',titleDesign:m.titleDesign({})};edit.titleDesign.custom=m.titleStyle({italic:true,letterSpacing:7,opacity:.6,stroke:{enabled:false},shadow:{enabled:false},background:{enabled:false,radius:42}});
 const before=JSON.stringify(edit),selected=m.selectTitleTemplate(edit,m.titleTemplates.find(t=>t.name==='橙白粗黑宋'));assert.equal(JSON.stringify(edit),before);edit.titleDesign=selected;
 const s=m.titleSnapshot(edit,360,640);assert.equal(s.style.italic,true);assert.equal(s.style.letterSpacing,7);assert.equal(s.style.stroke.enabled,false);assert.equal(s.style.shadow.enabled,false);assert.equal(s.style.fontFamily,'方正粗黑宋简体');assert.equal(s.design.custom.background.radius,42);assert.equal(s.style.opacity,.6);
 edit.titleDesign.mode='custom';assert.equal(m.titleSnapshot(edit,360,640).style.italic,true);
});
test('有效模板样式的非法开关、字形或颜色不进入输出',async()=>{
 const m=await model,d=m.selectTitleTemplate({titleDesign:m.titleDesign({})},m.titleTemplates[0]);
 for(const patch of [{enableStroke:'true'},{fontStyles:['fake']},{color:'red'}])assert.throws(()=>m.validateTitleDesign({...d,templateStyle:{...d.templateStyle,...patch}}));
 assert.throws(()=>m.validateTitleDesign({...d,templateStyle:[]}));
});
