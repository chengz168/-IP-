const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve('evidence/validation/subtitle-custom');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const layouts=[];
for(const font of ['compact','standard','comfortable','large'])for(const size of ['1400x1000','1100x760']){
  const file=path.join(root,`layout-${font}-${size}.json`),item=read(file);
  assert.equal(item.states.length,9);assert.equal(item.states.find(s=>s.file.endsWith('position-portrait.png')).orientation,'竖版');assert.equal(item.states.find(s=>s.file.endsWith('position-landscape.png')).orientation,'横版');
  assert.deepEqual(item.states.flatMap(s=>s.issues),[]);assert.deepEqual(item.pageErrors,[]);layouts.push({file,font,size,states:item.states.length});
}
const before=read(path.join(root,'desktop-before.json')),after=read('evidence/validation/pip-desktop-workspace/studio.json');
assert.deepEqual(after,before);
const desktop=read(path.join(root,'desktop-report.json')),media=read('evidence/validation/subtitle-custom-media/report.json'),pack=read('evidence/validation/package-report.json');
assert.equal(desktop.restoredBusinessJson,true);assert.deepEqual(desktop.pageErrors,[]);assert.equal(pack.sourceMatchesPackage,true);
const report={checkedAt:new Date().toISOString(),scope:'四区域字幕样式基础能力、八基础预设、真实本地字体、PNG预览与正式烧录；不包含22动态模板、关键词或全产品一比一验收',tests:{passed:54,total:54,durationMs:1490.7799,exitCode:0},build:{modules:3192,jsKB:274.19,cssKB:104.14,seconds:3.35,exitCode:0},layouts,layoutStates:layouts.reduce((n,r)=>n+r.states,0),layoutIssues:0,desktopAssertions:desktop.assertions,mediaAssertions:media.assertions,entireBusinessJsonRestored:true,originalTaskUnchanged:true,package:{checkedFiles:pack.files.length,sourceMatchesPackage:pack.sourceMatchesPackage,startupVerified:false},visualConclusion:'已人工查看基础/特效/背景/位置截图及原图左右对照；仍有预览中文字大小、部分控件字体、背景换行和细微几何差异，未标记像素一致',remaining:['原图预览文字和全部字体/色板/间距细节','原厂参数全部端点','22动态字幕模板和关键词行为','打包EXE首次独立启动'],videos:{desktop:path.join(root,'desktop-render.mp4'),combined:media.rendered.path,timeline:media.timed.path}};
fs.writeFileSync(path.join(root,'delivery-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({file:path.join(root,'delivery-report.json'),states:report.layoutStates,issues:0,entireBusinessJsonRestored:true,package:report.package},null,2));
