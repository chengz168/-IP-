const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const vue=require('vue'),sfc=require('@vue/compiler-sfc');
const {creativeCatalog,creativeSources}=require('../server/creative-presets.mjs');
const {creativeStageNames,productionSkillCatalog}=require('../server/production-skills.mjs');
const filename=path.resolve(__dirname,'../src/components/CreativeSkillLibrary.vue'),descriptor=sfc.parse(fs.readFileSync(filename,'utf8'),{filename}).descriptor;
const compiled=sfc.compileScript(descriptor,{id:'creative-skill-library-ui'}).content.replace(/^import .*;\r?\n/gm,'').replace('export default','return');
test('设置技能库按中文规则和阶段检索，空结果可恢复，清单状态与生成记录准确',()=>{
 const draft=vue.ref({id:'user-task',title:'我的原任务'}),state=vue.ref({runs:[{draftId:'user-task',output:{modelExecuted:false,creativePreset:{name:'本地切分'}}},{draftId:'other-task',output:{creativePreset:{name:'其他任务'}}},{draftId:'user-task',output:{creativePreset:{name:'实际生成',stage:'script'}}}]});
 const component=new Function('computed','inject','ref','creativeCatalog','creativeSources','creativeStageNames','productionSkillCatalog','CreativePresets','Modal',compiled)(vue.computed,()=>({draft,state}),vue.ref,creativeCatalog,creativeSources,creativeStageNames,productionSkillCatalog,{},{}),vm=component.setup({},{expose(){}});
 assert.equal(vm.entries.value.length,20);vm.search.value='语义停顿';assert.deepEqual(vm.entries.value.map(s=>s.id),['speech-performance']);vm.stage.value='video';assert.equal(vm.entries.value.length,0);vm.clearFilters();assert.equal(vm.entries.value.length,20);
 vm.stage.value='voice';assert.equal(vm.entries.value.length,1);assert.equal(vm.entries.value[0].execution,'checklist');vm.detail.value=vm.entries.value[0];assert.equal(vm.detailRules.value[0].name,'配音');assert.equal(vm.detail.value.origin.project,'视频工厂');
 assert.equal(vm.recent.value.output.creativePreset.name,'实际生成');assert.equal(vm.promptStages.some(([stage])=>stage==='voice'),false);assert.ok(vm.promptStages.some(([stage])=>stage==='image'));
 assert.equal(Object.hasOwn(draft.value,'creativePreset'),false);assert.equal(draft.value.title,'我的原任务');
 assert.deepEqual(sfc.compileTemplate({id:'creative-skill-library-ui',filename,source:descriptor.template.content}).errors,[]);
});
test('来源清单保留上游文件摘要，应用不依赖视频工厂安装路径',()=>{
 const manifest=require('../server/production-skill-sources.json');assert.equal(manifest.revision,'815f29ff9a17e89c68e9c7a479237a5ba56e2b32');assert.equal(manifest.sourceFiles.length,3);for(const file of manifest.sourceFiles)assert.match(file.sha256,/^[a-f0-9]{64}$/);
 const methods=productionSkillCatalog();for(const method of methods){assert.equal(method.origin.revision,manifest.revision);assert.ok(method.origin.files.every(file=>manifest.sourceFiles.some(row=>row.path===file)));assert.ok(method.stages.every(stage=>[...manifest.automaticStages,...manifest.manualChecklists].includes(stage)));}
 const source=fs.readFileSync(path.resolve(__dirname,'../server/production-skills.mjs'),'utf8');assert.doesNotMatch(source,/P02|P04|P07|require\(|readFileSync|execFile|spawn\(/);
});
