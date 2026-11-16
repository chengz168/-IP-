const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('标题目录对照真实28项观察，显示名称不改变ID及family',async()=>{
 const {titleFontCatalog}=await import('../src/title-font-catalog.mjs');
 const fonts=JSON.parse(fs.readFileSync('evidence/validation/title-font-catalog/local-font-catalog-before.json'));
 const observed=JSON.parse(fs.readFileSync('evidence/validation/title-font-catalog/observed-font-order.json'));
 const before=JSON.stringify(fonts),rows=titleFontCatalog(fonts);
 assert.deepEqual(rows.map(f=>f.label),observed.orderedNames);
 assert.deepEqual(rows.map(f=>[f.id,f.family]),fonts.map(f=>[f.id,f.family]));
 assert.equal(JSON.stringify(fonts),before);
});

test('本地目录优先，用户字体保留原名，旧系统及TTC选中信息不丢失',async()=>{
 const {titleFontCatalog}=await import('../src/title-font-catalog.mjs');
 const sys={id:'system',family:'System',label:'系统',face:0,source:'system'},face={...sys,id:'face',face:1};
 const local={id:'local',family:'Custom',label:'用户自定义',face:0,source:'local'};
 assert.deepEqual(titleFontCatalog([sys,local,face]),[local]);
 assert.deepEqual(titleFontCatalog([sys,local,face],{fontId:sys.id}),[local,sys]);
 assert.deepEqual(titleFontCatalog([sys,local,face],{fontId:face.id}),[local,face]);
 assert.deepEqual(titleFontCatalog([sys,local],{fontFamily:sys.family}),[local,sys]);
 assert.deepEqual(titleFontCatalog([sys,face]),[sys]);
});

test('缺失字体保留名称和ID以呈现原加载错误，不冒充其他字体',async()=>{
 const {titleFontCatalog}=await import('../src/title-font-catalog.mjs');
 assert.deepEqual(titleFontCatalog([],{fontId:'missing',fontFamily:'旧字体'}),[{id:'missing',family:'旧字体',label:'旧字体',missing:true}]);
 assert.equal(titleFontCatalog([],{fontId:'missing'})[0].label,'字体已缺失');
 assert.deepEqual(titleFontCatalog([]),[]);
});
