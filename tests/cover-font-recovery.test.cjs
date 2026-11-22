const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vue=require('vue'),sfc=require('@vue/compiler-sfc');
const helper=()=>import('../src/cover-font-recovery.mjs');
async function sceneFixture(){const {templateScene}=await import('../src/cover-model.mjs'),scene=templateScene('default','真实封面标题','副标题');scene.layers=[{...scene.layers[0],id:'missing',style:{...scene.layers[0].style,fontFamily:'失效附加字体',fontId:'missing-font',renderFamily:'old-render'}},{...structuredClone(scene.layers[0]),id:'existing',text:'保留文字',style:{...scene.layers[0].style,fontId:'existing-font',fontFamily:'现有字体',renderFamily:'existing-render'}},{...structuredClone(scene.layers[0]),id:'system',text:'原系统字',style:{...scene.layers[0].style,fontId:'',fontFamily:'Microsoft YaHei'}}];return scene;}
test('显式恢复仅替换确实不可用的字体，不污染输入、模板或其他图层样式',async()=>{
 const {recoverMissingCoverFonts}=await helper(),scene=await sceneFixture(),before=structuredClone(scene),calls=[];
 const result=await recoverMissingCoverFonts(scene,[{id:'existing-font',family:'现有字体',label:'现有字体'}],{loadFont:async font=>{calls.push(font.id);return 'existing-render';},hasLocalFont:async family=>family==='Microsoft YaHei'});
 assert.deepEqual(scene,before);assert.equal(result.replaced.length,1);assert.equal(result.family,'Microsoft YaHei');assert.equal(result.scene.templateId,before.templateId);assert.deepEqual(result.scene.layers.slice(1),before.layers.slice(1));
 const expected=structuredClone(before);expected.layers[0].style.fontFamily='Microsoft YaHei';expected.layers[0].style.fontId='';delete expected.layers[0].style.renderFamily;assert.deepEqual(result.scene,expected);assert.deepEqual(calls,['existing-font']);
});
test('本机字体真实可用即保留，系统字两种名称都缺失时拒绝且不改输入',async()=>{
 const {recoverMissingCoverFonts}=await helper(),scene=await sceneFixture(),before=structuredClone(scene);
 const kept=await recoverMissingCoverFonts(scene,[],{loadFont:async()=>assert.fail('不应加载未匹配字体'),hasLocalFont:async()=>true});assert.equal(kept.replaced.length,0);assert.equal(kept.repaired.length,2);assert.deepEqual(kept.scene.layers.map(layer=>layer.style.fontFamily),before.layers.map(layer=>layer.style.fontFamily));assert(kept.scene.layers.every(layer=>!layer.style.fontId));assert.deepEqual(scene,before);
 await assert.rejects(recoverMissingCoverFonts(scene,[],{loadFont:async()=>'',hasLocalFont:async()=>false}),/未确认本机可用/);assert.deepEqual(scene,before);
});
test('空目录列表且系统字体仍可用时清理旧ID，真实prepareCoverFonts能够继续绘制准备',async()=>{
 const {recoverMissingCoverFonts}=await helper(),{prepareCoverFonts}=await import('../src/cover-fonts.mjs'),scene=await sceneFixture();scene.layers=[scene.layers[2]];scene.layers[0].style.fontId='stale-id';scene.layers[0].style.renderFamily='old-alias';const before=structuredClone(scene);
 await assert.rejects(prepareCoverFonts(scene,[],()=>assert.fail()),/字体已缺失/);
 const result=await recoverMissingCoverFonts(scene,[],{loadFont:()=>assert.fail(),hasLocalFont:async name=>name==='Microsoft YaHei'});assert.equal(result.replaced.length,0);assert.equal(result.repaired.length,1);assert.equal(result.scene.layers[0].style.fontFamily,'Microsoft YaHei');assert.equal(result.scene.layers[0].style.fontId,'');assert.equal(Object.hasOwn(result.scene.layers[0].style,'renderFamily'),false);assert.deepEqual(scene,before);
 const prepared=await prepareCoverFonts(result.scene,[],()=>assert.fail());assert.equal(prepared.layers[0].style.fontFamily,'Microsoft YaHei');
});
test('已列出字体加载失败时再核对本机可用性，不把单次加载失败直接当缺失',async()=>{
 const {recoverMissingCoverFonts}=await helper(),scene=await sceneFixture();scene.layers=[scene.layers[1]];
 const kept=await recoverMissingCoverFonts(scene,[{id:'existing-font',family:'现有字体'}],{loadFont:async()=>{throw Error('读取失败');},hasLocalFont:async name=>name==='现有字体'});assert.equal(kept.replaced.length,0);assert.deepEqual(kept.scene,scene);
 const replaced=await recoverMissingCoverFonts(scene,[{id:'existing-font',family:'现有字体'}],{loadFont:async()=>{throw Error('读取失败');},hasLocalFont:async name=>name==='微软雅黑'});assert.equal(replaced.family,'微软雅黑');assert.equal(replaced.scene.layers[0].style.fontFamily,'微软雅黑');
});
async function uiFixture(t,options={}){
 const model=await import('../src/cover-model.mjs'),fontHelper=await helper(),fontModule=await import('../src/cover-fonts.mjs'),cover={template:'default',title:'标题',subtitle:'副标题',modelVersion:1,backgroundId:'',scene:await sceneFixture()},draft=vue.ref({id:'cover-task',cover,edit:{},video:{},publish:{}}),state=vue.ref({assets:[],settings:{}}),busy=vue.ref(''),notifications=[];
 const studio={draft,state,busy,act:async(_,work)=>work(),notify:(...a)=>notifications.push(a)},filename=path.resolve(__dirname,'../src/components/CoverEditor.vue'),{descriptor}=sfc.parse(fs.readFileSync(filename,'utf8'),{filename});
 const source=sfc.compileScript(descriptor,{id:'font-recovery-ui'}).content.replace(/^import .*;\r?\n/gm,'').replace('export default','return');let unmount;
 const names=['inject','ref','watch','onMounted','onUnmounted','nextTick','computed','I','Modal','CoverTextProperties','CoverMaskProperties','CoverRange','call','mediaUrl','drawCover','prepareCoverFonts','recoverMissingCoverFonts','loadingThumbnails','renderThumbnails','downstreamText','FontFace','setTimeout','clearTimeout','document',...Object.keys(model)];
 const LocalFont=class{constructor(alias,source){this.source=source;}async load(){const family=JSON.parse(this.source.slice(6,-1));const ok=options.local?await options.local(family):family==='Microsoft YaHei'||family==='现有字体';if(!ok)throw Error('本机无此字体');return this;}};
 const values=[()=>studio,vue.ref,vue.watch,()=>{},fn=>unmount=fn,vue.nextTick,vue.computed,{},{},{},{},{},options.call||(async()=>[]),id=>id,options.draw||(()=>[]),options.prepare||fontModule.prepareCoverFonts,fontHelper.recoverMissingCoverFonts,options.loading||(()=>({})),options.render||(async()=>{}),()=>'',LocalFont,options.timer||(()=>1),()=>{},options.document||{},...Object.values(model)];
 const scope=vue.effectScope(),component=new Function(...names,source)(...values),vm=scope.run(()=>component.setup({}, {expose(){},emit(){}}));vm.error.value='未找到封面字体“失效附加字体”';
 t.after(()=>{unmount?.();scope.stop();});return {vm,draft,state,busy,notifications,descriptor,filename,unmount:()=>unmount?.()};
}
test('真实组件没有静默修改，明确点击才恢复当前封面，保留缺字错误及恢复说明',async t=>{
 const f=await uiFixture(t);f.draft.value.cover.scene.layers.splice(1,1);const before=JSON.parse(JSON.stringify(f.draft.value.cover));assert.equal(f.vm.recoveringFonts.value,false);assert.equal(f.draft.value.cover.scene.layers[0].style.fontFamily,'失效附加字体');await f.vm.recoverCurrentFonts();assert.equal(f.draft.value.cover.scene.layers[0].style.fontFamily,'Microsoft YaHei');assert.equal(f.draft.value.cover.scene.layers[1].style.fontFamily,'Microsoft YaHei');assert.equal(f.draft.value.cover.template,before.template);assert.match(f.vm.fontRecoveryMessage.value,/1 个缺失字体图层/);assert.equal(f.vm.recoveringFonts.value,false);
 assert.match(f.descriptor.template.content,/改用本机系统字体/);assert.match(f.descriptor.template.content,/v-if="error" class="cover-error" role="alert"/);assert.deepEqual(sfc.compileTemplate({id:'font-recovery-ui',filename:f.filename,source:f.descriptor.template.content}).errors,[]);
});
test('本机自定义字体有旧ID但原准备契约仍拒绝时，组件不提交半份场景并显示真实错误',async t=>{
 const f=await uiFixture(t),before=JSON.stringify(f.draft.value.cover);await f.vm.recoverCurrentFonts();assert.equal(JSON.stringify(f.draft.value.cover),before);assert.match(f.vm.fontRecoveryMessage.value,/未找到封面字体“现有字体”/);assert.doesNotMatch(f.vm.fontRecoveryMessage.value,/已清理|已将当前封面/);assert.match(f.vm.error.value,/未找到封面字体/);
});
test('真实组件仅有失效系统字体ID时仍提交修复，说明保留原字形而非更换字体',async t=>{
 const f=await uiFixture(t),layer=JSON.parse(JSON.stringify(f.draft.value.cover.scene.layers[2]));layer.style.fontId='stale-system-id';f.draft.value.cover.scene.layers=[layer];const before=JSON.parse(JSON.stringify(f.vm.scene.value));
 await f.vm.recoverCurrentFonts();assert.equal(f.draft.value.cover.scene.layers[0].style.fontId,'');assert.equal(f.draft.value.cover.scene.layers[0].style.fontFamily,'Microsoft YaHei');assert.equal(f.draft.value.cover.scene.layers[0].text,before.layers[0].text);assert.match(f.vm.fontRecoveryMessage.value,/清理 1 个失效字体文件引用，保留本机可用的原字体/);assert.doesNotMatch(f.vm.fontRecoveryMessage.value,/缺失字体图层改用/);
});
test('忙碌、导出与行内编辑阻止恢复，没有可用系统字体则原场景保留',async t=>{
 for(const key of ['busy','exporting','editing']){const f=await uiFixture(t),before=JSON.stringify(f.draft.value.cover);if(key==='busy')f.busy.value='正在执行';else f.vm[key].value=true;await f.vm.recoverCurrentFonts();assert.equal(JSON.stringify(f.draft.value.cover),before);assert.equal(f.vm.fontRecoveryMessage.value,'');}
 const f=await uiFixture(t,{local:async()=>false}),before=JSON.stringify(f.draft.value.cover);await f.vm.recoverCurrentFonts();assert.equal(JSON.stringify(f.draft.value.cover),before);assert.match(f.vm.fontRecoveryMessage.value,/未确认本机可用/);assert.match(f.vm.error.value,/未找到封面字体/);
});
test('字体检查期间任务、签名变化或卸载后丢弃旧恢复，不重复提交',async t=>{
 for(const mode of ['task','signature','unmount']){
  let release;const hold=new Promise(resolve=>release=resolve);let entered=false;const f=await uiFixture(t,{local:async family=>{entered=true;await hold;return family==='Microsoft YaHei'||family==='现有字体';}}),before=JSON.parse(JSON.stringify(f.draft.value.cover));
  const work=f.vm.recoverCurrentFonts();while(!entered)await Promise.resolve();assert.equal(f.vm.recoveringFonts.value,true);await f.vm.recoverCurrentFonts();
  if(mode==='task')f.draft.value.id='other-task';if(mode==='signature')f.draft.value.cover.title='用户新标题';if(mode==='unmount')f.unmount();release();await work;
  assert.deepEqual(JSON.parse(JSON.stringify(f.draft.value.cover.scene)),before.scene);assert.equal(f.vm.fontRecoveryMessage.value,'');
 }
});

test('系统模板开关默认关闭且切换本身不改场景、原模板或默认设置',async t=>{
 const f=await uiFixture(t),before=JSON.stringify(f.draft.value.cover),settings=JSON.stringify(f.state.value.settings);assert.equal(f.vm.systemTemplateMode.value,false);f.vm.systemTemplateMode.value=true;assert.equal(JSON.stringify(f.draft.value.cover),before);assert.equal(JSON.stringify(f.state.value.settings),settings);f.vm.systemTemplateMode.value=false;assert.equal(JSON.stringify(f.draft.value.cover),before);assert.match(f.descriptor.template.content,/系统字体模板/);assert.match(f.descriptor.template.content,/系统字体版/);
});
test('系统模板明确点选后才提交已准备的对应版式，普通模式仍保留原始字体',async t=>{
 const {coverTemplates,templateScene}=await import('../src/cover-model.mjs'),id=coverTemplates.find(item=>templateScene(item.id).layers.some(layer=>!['Microsoft YaHei','微软雅黑','Arial'].includes(layer.style.fontFamily))).id,f=await uiFixture(t),before=JSON.stringify(coverTemplates);
 await f.vm.chooseTemplate(id);assert.equal(f.draft.value.cover.template,id);assert.equal(f.vm.scene.value.layers.some(layer=>!['Microsoft YaHei','微软雅黑','Arial'].includes(layer.style.fontFamily)),true);assert.equal(f.vm.scene.value.fontVariant,undefined);
 f.vm.systemTemplateMode.value=true;await f.vm.chooseTemplate(id);assert.equal(f.vm.scene.value.fontVariant,'system');assert.equal(f.vm.scene.value.templateId,id);assert.equal(f.vm.scene.value.layers.every(layer=>['Microsoft YaHei','微软雅黑','Arial'].includes(layer.style.fontFamily)),true);assert.match(f.vm.templateMessage.value,/已选用系统字体版/);assert.equal(JSON.stringify(coverTemplates),before);
});
test('系统模板字体准备失败时保持当前封面，不能提交半份模板或报成功',async t=>{
 const f=await uiFixture(t,{prepare:async()=>{throw Error('真实字体准备拒绝');}}),before=JSON.stringify(f.draft.value.cover);f.vm.systemTemplateMode.value=true;await f.vm.chooseTemplate('v4');assert.equal(JSON.stringify(f.draft.value.cover),before);assert.match(f.vm.templateMessage.value,/未能准备.*真实字体准备拒绝/);assert.equal(f.vm.templateApplying.value,false);
});
test('系统模板异步选用受任务、签名、开关、字体目录、卸载和新选择序号保护',async t=>{
 for(const mode of ['task','signature','mode','fonts','editing','unmount','newer']){
  let release,entered=false;const hold=new Promise(resolve=>release=resolve),f=await uiFixture(t,{local:async family=>{entered=true;await hold;return family==='Microsoft YaHei';}});f.vm.systemTemplateMode.value=true;const before=JSON.stringify(f.draft.value.cover.scene),work=f.vm.chooseTemplate('v4');while(!entered)await Promise.resolve();
  if(mode==='task')f.draft.value.id='other';if(mode==='signature')f.draft.value.cover.title='新标题';if(mode==='mode')f.vm.systemTemplateMode.value=false;if(mode==='fonts')f.state.value.settings.subtitleFontsDir='changed-directory';if(mode==='editing'){f.vm.editText.value='还没保存的编辑';f.vm.editing.value=true;}if(mode==='unmount')f.unmount();let newer;if(mode==='newer')newer=f.vm.chooseTemplate('v12');
  release();await work;if(newer)await newer;await vue.nextTick();
  if(mode==='newer'){assert.equal(f.vm.scene.value.templateId,'v12');assert.equal(f.vm.scene.value.fontVariant,'system');}else{assert.equal(JSON.stringify(f.draft.value.cover.scene),before);assert.equal(f.vm.templateMessage.value,'');if(mode==='editing'){assert.equal(f.vm.editText.value,'还没保存的编辑');assert.equal(f.vm.editing.value,true);}}
 }
});
test('模板缩略图普通模式保留真实字体失败，系统模式15个模板均经过恢复和原字体准备',async t=>{
 const thumbs=await import('../src/cover-thumbnails.mjs'),jobs=[],drawn=[],f=await uiFixture(t,{loading:thumbs.loadingThumbnails,render:thumbs.renderThumbnails,timer:fn=>{jobs.push(fn);return jobs.length;},draw:(canvas,input)=>{drawn.push(input);return [];},document:{createElement:()=>({toDataURL:()=> 'data:image/jpeg;base64,prepared'})}}),before=JSON.stringify(f.draft.value.cover);
 f.vm.scheduleThumbnails();await jobs.at(-1)();assert.equal(Object.values(f.vm.thumbnails.value).some(item=>item.status==='failed'),true);assert.equal(JSON.stringify(f.draft.value.cover),before);
 drawn.length=0;f.vm.systemTemplateMode.value=true;await jobs.at(-1)();assert.equal(Object.keys(f.vm.thumbnails.value).length,15);assert.equal(Object.values(f.vm.thumbnails.value).every(item=>item.status==='ready'),true);assert.equal(drawn.length,15);assert(drawn.every(input=>input.layers.every(layer=>['Microsoft YaHei','微软雅黑','Arial'].includes(layer.style.fontFamily))));assert.equal(JSON.stringify(f.draft.value.cover),before);
});
test('切开关或字体目录后旧系统模板预览不能回写成功',async t=>{
 const thumbs=await import('../src/cover-thumbnails.mjs');
 for(const mode of ['mode','fonts']){
  let release,entered=false;const hold=new Promise(resolve=>release=resolve),jobs=[],f=await uiFixture(t,{loading:thumbs.loadingThumbnails,render:thumbs.renderThumbnails,timer:fn=>{jobs.push(fn);return jobs.length;},local:async family=>{entered=true;await hold;return family==='Microsoft YaHei';},document:{createElement:()=>({toDataURL:()=> 'data:image/jpeg;base64,old'})}});f.vm.systemTemplateMode.value=true;const work=jobs.at(-1)();while(!entered)await Promise.resolve();
  if(mode==='mode')f.vm.systemTemplateMode.value=false;else f.state.value.settings.subtitleFontsDir='new-font-directory';release();await work;await vue.nextTick();assert.equal(Object.values(f.vm.thumbnails.value).some(item=>item.status==='ready'),false);
 }
});
test('字体目录变更使旧当前封面恢复失效，保留用户原场景',async t=>{
 let release,entered=false;const hold=new Promise(resolve=>release=resolve),f=await uiFixture(t,{local:async family=>{entered=true;await hold;return family==='Microsoft YaHei';}}),before=JSON.stringify(f.draft.value.cover);const work=f.vm.recoverCurrentFonts();while(!entered)await Promise.resolve();f.state.value.settings.subtitleFontsDir='new-directory';release();await work;assert.equal(JSON.stringify(f.draft.value.cover),before);assert.equal(f.vm.fontRecoveryMessage.value,'');
});
