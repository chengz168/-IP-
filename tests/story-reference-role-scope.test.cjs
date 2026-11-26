const {test}=require('node:test');
const assert=require('node:assert/strict');
const {referenceVideoPrompt,referenceVideoGraph}=require('../server/story-generator.cjs');

const input={prompt:'厨师从右侧入画，用铲子清洁扒炉。保留商品铭牌，背景不要复刻拍摄者。',instruction:'保留左侧要求的中文指示牌“清洁区”。',aspect:'9:16',duration:5};
const references=[
 {kind:'scene',name:'工厂操作区',description:'明亮、整洁的金属操作区'},
 {kind:'prop',name:'指定扒炉',description:'长方形金属烤面与前置旋钮'},
 {kind:'character',name:'指定厨师',description:'身穿白色厨师服的指定人物'},
 {kind:'product',name:'目标商品',description:'金属商品与已确认铭牌'},
 {kind:'style',name:'自然写实'},
 {name:'未分类的指定资产',description:'只参考指定红色支架'}
];
const line=(prompt,section,index)=>prompt.split(section+':')[1].split('\n').find(row=>row.startsWith('<Subject '+index+'>'));

test('场景与物体参考只继承指定角色，不把整张图中的人物倒影当作资产',()=>{
 const prompt=referenceVideoPrompt(input,references);
 const scene=line(prompt,'subject_definitions',1),prop=line(prompt,'subject_definitions',2),product=line(prompt,'subject_definitions',4);
 assert.match(scene,/environment's spatial layout, structures, materials, lighting and colors/);
 assert.match(scene,/people, photographers and their reflections in the source image are not environment assets/);
 for(const [row,name]of [[prop,'object'],[product,'product']]){
  assert.match(row,new RegExp('designated '+name+"'s geometry, components, materials, colors and confirmed"));
  assert.match(row,/surrounding people, hands, photographers and their reflections are not part of/);
 }
 assert.match(prompt,/Do not automatically inherit unbound people, photographers, human reflections, application interfaces, overlays or subtitles merely because they appear/);
 assert.doesNotMatch(prompt,/Preserve the reference's assigned visible role, identity, geometry, materials, colors and markings/);
});

test('显式人物与用户要求仍保留，不使用全局无人规则或删除镜头要求',()=>{
 const prompt=referenceVideoPrompt(input,references),character=line(prompt,'subject_definitions',3);
 assert.match(character,/Preserve only the designated character's identity and explicitly assigned appearance, clothing and features/);
 assert.match(character,/身穿白色厨师服的指定人物/);
 assert.match(prompt,/preserve explicitly bound characters/);
 assert.match(prompt,/Include a person or visible text when explicitly bound to the corresponding role or explicitly required by the saved scene requirements/);
 assert(prompt.includes(input.prompt));assert(prompt.includes(input.instruction));
 assert.doesNotMatch(prompt,/no people|never include people|people are forbidden/i);
});

test('风格使用官方弱参考关系，未分类资产不扩大到全部可见内容',()=>{
 const prompt=referenceVideoPrompt(input,references);
 assert.match(line(prompt,'retention_analysis',5),/: weak_reference - Reference only the assigned visual style/);
 assert.match(line(prompt,'subject_definitions',6),/Preserve only the named asset and its explicitly supplied description/);
 assert.match(line(prompt,'subject_definitions',6),/只参考指定红色支架/);
 for(const index of [1,2,3,4,6])assert.match(line(prompt,'retention_analysis',index),/: fully_preserved -/);
 assert.match(prompt,/subject_definitions:[\s\S]*summary:[\s\S]*retention_analysis:[\s\S]*detailed_description:[\s\S]*overall_soundscape:[\s\S]*non_diegetic_music:/);
});

test('实际REF2VA图使用相同角色约束且Picture顺序保持上传顺序',()=>{
 const images=references.map((_,index)=>'reference-'+index+'.png');
 const graph=referenceVideoGraph({input:{...input,references},images});
 assert.equal(graph['6'].inputs.prompt,referenceVideoPrompt(input,references));
 references.forEach((ref,index)=>{
  assert.equal(graph[String(17+index)].inputs.image,images[index]);
  assert.deepEqual(graph['6'].inputs['ref_images.ref_image_'+index],[String(17+index),0]);
  assert(line(graph['6'].inputs.prompt,'subject_definitions',index+1).includes('from <Picture '+(index+1)+'>. Asset identity: '+ref.name+'.'));
 });
});
