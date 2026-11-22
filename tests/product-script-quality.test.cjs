const test=require('node:test'),assert=require('node:assert/strict');
const {productScriptIssues}=require('../server/product-script-quality.cjs');
test('动态商品脚本检查识别超预算、英文依据与全静态退化',()=>{
 const shots=[{text:'介绍商品'.repeat(20),action:'无主体动作变化，仅展示静止外观',camera:'中景固定机位',evidence:'visualObservations[0].visible'}];
 const issues=productScriptIssues(shots,15);
 assert.ok(issues.some(v=>v.includes('字预算')));assert.ok(issues.some(v=>v.includes('全部镜头')));assert.ok(issues.some(v=>v.includes('可读中文')));
});
test('允许静态细节与真实动作交替，固定机位和运动机位不能混写',()=>{
 const shots=[{text:'看看羽毛的配色。',action:'保持静止',camera:'近景固定机位',evidence:'第1张图可见羽毛'}, {text:'轻摆后羽毛回到原位。',action:'人手轻轻向左摆动原杆后回正，羽毛随动',camera:'中景固定机位',evidence:'商品名称和原图'}];
 assert.deepEqual(productScriptIssues(shots,15),[]);
 shots[1].camera='固定机位推近再拉远';assert.match(productScriptIssues(shots,15).join(''),/机位矛盾/);
});

test('局部静止不等于整镜静态，杆身固定但羽毛摆动仍可通过',()=>{
 assert.deepEqual(productScriptIssues([{text:'羽毛随风摆动。',action:'杆身保持静止，羽毛从开头向左摆动并回到中间',camera:'近景固定机位',evidence:'原图可见羽毛'}],5),[]);
});
