const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {resolveCreativePreset,creativePresetPrompt}=require('../server/creative-presets.mjs');
const {githubProductionSkillCatalog,githubProductionSkillSources}=require('../server/github-production-skills.mjs');
const {createService}=require('../server/service.cjs');
test('外部中文方法按题材与阶段生效，关闭及分析阶段不串入规则',()=>{
 const draft={creativePreset:{mode:'manual',presetId:'product'}};
 for(const stage of ['script','rewrite','shots']){const route=resolveCreativePreset(draft,stage);assert.ok(route.skills.some(skill=>skill.id==='product-evidence-mapping'));assert.ok(route.sources.some(source=>source.id==='github-ads-creative'));assert.match(creativePresetPrompt(route),/真实投放效果/);}
 for(const stage of ['shots','image']){const route=resolveCreativePreset({creativePreset:{mode:'manual',presetId:'story'}},stage);assert.ok(route.skills.some(skill=>skill.id==='visual-story-focus'));assert.ok(route.sources.some(source=>source.id==='github-video-design'));assert.equal(route.skills.some(skill=>skill.id==='product-evidence-mapping'),false);}
 for(const stage of ['topic','episodes','assets','video','analysis'])assert.equal(resolveCreativePreset(draft,stage).skills.some(skill=>skill.id==='product-evidence-mapping'||skill.id==='visual-story-focus'),false);
 for(const stage of ['script','shots','image'])assert.deepEqual(resolveCreativePreset({creativePreset:{mode:'off'}},stage).sources,[]);
 const copy=githubProductionSkillCatalog();copy[0].rules.length=0;assert.ok(githubProductionSkillCatalog()[0].rules.length>0);
});
test('公开方法来源有固定提交、可发行许可和确定摘要，不依赖外部脚本执行',()=>{
 const manifest=require('../server/github-production-skill-sources.json');const expected={'github-video-design':'162503c80495481d014e785652fce1422f844792b40c436b3f290f1e7c6f5514','github-ads-creative':'4cf88555061246505d007be0014f57a5c8df11593599f53aa3d908235c56bfd4'};
 assert.equal(manifest.executedExternalScripts,false);
 for(const source of githubProductionSkillSources){const record=manifest.sources.find(item=>item.id===source.id);assert.ok(record);assert.equal(source.revision,record.commit);assert.equal(record.sha256,expected[source.id]);assert.equal(record.license,'MIT');assert.ok(source.url.includes(record.commit));assert.ok(record.url.endsWith(record.path));}
 const notice=fs.readFileSync(path.join(__dirname,'../server/GITHUB-PRODUCTION-SKILLS-NOTICE.txt'),'utf8');assert.match(notice,/Copyright \(c\) 2024 Digital Samba/);assert.match(notice,/Copyright \(c\) 2026 Daniel Agrici/);assert.equal((notice.match(/THE SOFTWARE IS PROVIDED "AS IS"/g)||[]).length,2);
});
test('商品文案真实请求携带公开方法，执行记录保存精确来源快照',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'github-production-skills-')),listeners=new Set(process.listeners('exit')),service=createService(root),added=process.listeners('exit').filter(fn=>!listeners.has(fn));
 t.after(()=>{for(const fn of added)process.removeListener('exit',fn);fs.rmSync(root,{recursive:true,force:true});});
 const draft=service.store.draft();Object.assign(draft.marketing,{name:'分格收纳盒',selling:'分格整理文具'});draft.creativePreset={mode:'manual',presetId:'product',instruction:''};service.store.save();const requests=[];
 service.providers.text=async(system,user)=>{requests.push({system,user});return {text:JSON.stringify({candidates:Array.from({length:3},()=>({text:'文具按用途放进分格收纳盒。取用后再归位，桌面更容易保持清楚。'}))})};};
 const output=await service.invoke('copyCandidates',{id:draft.id,kind:'marketing'});assert.match(requests[0].system,/商品卖点与画面证据/);assert.match(requests[0].system,/图标只作信息辅助/);const source=output.creativePreset.sources.find(item=>item.id==='github-ads-creative');assert.equal(source.revision,'fc3908e786c318776df89a3a098333da377364be');assert.deepEqual(service.store.draft(draft.id).copyStudio.marketing.candidates.input.creativePreset.sources,output.creativePreset.sources);
});
