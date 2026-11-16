const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');

test('真实字体准备报缺失时预览进入失败并保留原因，其他模板继续，补字体后可重新成功',async()=>{
 const {renderThumbnails}=await import('../src/cover-thumbnails.mjs'),{prepareCoverFonts}=await import('../src/cover-fonts.mjs'),{templateScene,coverTemplates}=await import('../src/cover-model.mjs');
 const missing=coverTemplates.find(t=>templateScene(t.id).layers.some(l=>!['Microsoft YaHei','微软雅黑','Arial'].includes(l.style.fontFamily))),scene=templateScene(missing.id,'缺字体验证');let publications=[];
 const render=async item=>{if(item.id==='missing')await prepareCoverFonts(scene,[],()=>assert.fail('缺失字体不能悄悄替换为系统字体'));return 'data:image/jpeg;base64,ready';};
 await renderThumbnails({items:[{id:'missing'},{id:'ready'}],render,isCurrent:()=>true,publish:s=>publications.push(s)});
 assert.equal(publications[0].missing.status,'loading');const final=publications.at(-1);assert.equal(final.missing.status,'failed');assert.match(final.missing.error,/未找到封面字体/);assert.equal(final.ready.status,'ready');assert.equal(final.ready.error,'');
 // 不改变场景指定字体，仅在目录补齐后重新准备同一模板。
 const fonts=scene.layers.map((l,i)=>({id:'found-'+i,label:l.style.fontFamily,family:l.style.fontFamily}));publications=[];
 await renderThumbnails({items:[{id:'missing'}],render:async()=>{await prepareCoverFonts(scene,fonts,async f=>'loaded_'+f.id);return 'data:image/jpeg;base64,recovered';},isCurrent:()=>true,publish:s=>publications.push(s)});assert.equal(publications.at(-1).missing.status,'ready');assert.equal(publications.at(-1).missing.error,'');
});

test('异步预览完成前切换revision或任务ID后不提交旧成功或失败，不继续后续模板',async()=>{
 const {renderThumbnails}=await import('../src/cover-thumbnails.mjs');
 for(const change of ['revision','id'])for(const fails of [false,true]){
  let revision=1,id='first',release,calls=0;const pending=new Promise(resolve=>release=resolve),publications=[];
  const work=renderThumbnails({items:[{id:'one'},{id:'two'}],isCurrent:()=>revision===1&&id==='first',publish:s=>publications.push(s),render:async()=>{calls++;await pending;if(fails)throw Error('旧错误不能覆盖新任务');return 'old-image';}});
  if(change==='revision')revision++;else id='second';release();await work;assert.equal(publications.length,1);assert.equal(publications[0].one.status,'loading');assert.equal(calls,1);
 }
});

test('封面组件和模板编译通过，失败详情可键盘展开且模板选择按钮没有因失败禁用',()=>{
 const {parse,compileScript,compileTemplate}=require('@vue/compiler-sfc'),file=path.resolve(__dirname,'../src/components/CoverEditor.vue'),{descriptor,errors}=parse(fs.readFileSync(file,'utf8'));assert.deepEqual(errors,[]);compileScript(descriptor,{id:'cover-thumb-test'});const compiled=compileTemplate({id:'cover-thumb-test',source:descriptor.template.content,filename:file});assert.deepEqual(compiled.errors,[]);
 assert.match(descriptor.template.content,/<details[^>]*class="cover-template-error"/);assert.match(descriptor.template.content,/查看失败原因/);assert.match(descriptor.template.content,/<button class="cover-template-select"[^>]*@click="chooseTemplate\(item.id\)"/);assert.doesNotMatch(descriptor.template.content,/<button class="cover-template-select"[^>]*:disabled/);
});
