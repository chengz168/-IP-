const test=require('node:test'),assert=require('node:assert/strict');
test('模板转自定义保留字形和透明度且不修改模板元数据',async()=>{
 const m=await import('../server/title-model.mjs'),before=JSON.stringify(m.titleTemplates);
 for(const t of m.titleTemplates){const original=m.templateTitleStyle(t),inherited=m.customTitleFromTemplate(t),d={...m.titleDesign({}),mode:'custom',custom:{...inherited.style,templateOffsetX:inherited.offsetX}};const validated=m.validateTitleDesign(d);for(const key of ['fontFamily','fontSize','fontWeight','color','secondaryColor','italic','top'])assert.equal(validated.custom[key],original[key],t.id+'/'+key);assert.equal(validated.custom.templateOffsetX,original.templateOffsetX);for(const key of ['shadow','background']){assert.match(validated.custom[key].color,/^#[0-9A-F]{6}$/i);const rgba=/rgba\([^,]+,[^,]+,[^,]+,([\d.]+)\)/.exec(original[key].color);assert.equal(validated.custom[key].opacity,original[key].opacity*(rgba?Number(rgba[1]):1));}}
 assert.equal(JSON.stringify(m.titleTemplates),before);
});
test('继承模板横向位置和字重拒绝非有限值',async()=>{const m=await import('../server/title-model.mjs');for(const patch of [{templateOffsetX:Infinity},{fontWeight:NaN}])assert.throws(()=>m.validateTitleDesign({...m.titleDesign({}),custom:m.titleStyle(patch)}));});
