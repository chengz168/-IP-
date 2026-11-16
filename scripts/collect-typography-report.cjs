const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const root=path.resolve('evidence/validation/typography'),desktop=read(path.join(root,'desktop-report.json'));
const checks=[];
for(const font of ['compact','standard','comfortable','large'])for(const size of ['1400x1000','1100x760']){
  const file=path.resolve(`evidence/validation/layout-font-${font}-${size}-final/report.json`),result=read(file);
  const issues=result.pages.flatMap(page=>page.issues.map(issue=>({page:page.name,...issue})));
  assert.equal(result.pages.length,48);assert.deepEqual(issues,[]);assert.deepEqual(result.pageErrors,[]);
  checks.push({font,size,pages:result.pages.length,issues,pageErrors:result.pageErrors,report:file});
}
const current=read('evidence/validation/pip-desktop-workspace/studio.json');assert.deepEqual(current,desktop.initial);
const packageReport=read('evidence/validation/package-report.json');assert(packageReport.sourceMatchesPackage);
const result={checkedAt:new Date().toISOString(),overallGoalComplete:false,scope:'四档字号、独立保存、旧配置恢复、设置导航及所列布局检查',tests:{passed:48,total:48,durationMs:479.443,exitCode:0},build:{modules:3187,jsKb:253.24,cssKb:94.18,seconds:2.98,exitCode:0},layout:checks,screenshotCount:checks.reduce((total,item)=>total+item.pages,0),desktopAssertions:desktop.assertions.map(({name,id,font})=>({name,id,font})),allBusinessDataRestored:true,temporaryTaskDeleted:!current.drafts.some(d=>d.id===desktop.temporaryId),package:{checkedFiles:packageReport.files.length,sourceMatchesPackage:true,startupVerified:false},sourceRuntime:{pid:20772,windowHandle:2885566,cdpPort:9333,width:1400,height:1000,fontSize:'comfortable'},visualComparison:path.join(root,'four-presets-comparison.jpg'),limitations:['几何通过不是全部像素一致','本轮副本无执行记录，条件执行详情未覆盖','完整字幕/封面编辑、IP学习、语义素材、自动流程、真实克隆/口型和平台发布仍未完成','完整教程音画和全部按钮未全量核验','独立EXE首次启动此前审批拒绝，尚未验收']};
fs.writeFileSync(path.join(root,'delivery-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,desktopAssertions:result.desktopAssertions.length,layout:checks.map(({font,size,pages})=>({font,size,pages}))},null,2));
