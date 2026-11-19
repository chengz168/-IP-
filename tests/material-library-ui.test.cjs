const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vue=require('vue'),sfc=require('@vue/compiler-sfc');

function fixture(){
 const filename=path.resolve(__dirname,'../src/components/MaterialLibrary.vue'),{descriptor}=sfc.parse(fs.readFileSync(filename,'utf8'),{filename}),state=vue.ref({assets:Array.from({length:26},(_,index)=>({id:'asset-'+index,name:'素材'+index,type:index%2?'image':'video',category:'测试分类',description:'素材描述',tags:[]})),runs:[],categories:['全部素材','测试分类']}),calls=[];
 const studio={state,draft:vue.ref({id:'draft'}),busy:vue.ref(''),act:async(_,work)=>work(),refresh:async()=>{},notify(){},showDialog(){}};
 const code=sfc.compileScript(descriptor,{id:'material-ui'}).content.replace(/^import .*;\r?\n/gm,'').replace('export default','return'),names=['computed','inject','onUnmounted','ref','watch','I','Modal','call','mediaUrl','pickFiles','window'],values=[vue.computed,()=>studio,()=>{},vue.ref,vue.watch,{},{},async(action,payload)=>calls.push({action,payload}),id=>id,async()=>[],{studio:{}}],scope=vue.effectScope(),component=new Function(...names,code)(...values),vm=scope.run(()=>component.setup({}, {expose(){}}));
 return {vm,state,calls,descriptor,filename,dispose:()=>scope.stop()};
}

test('素材库与资源卡真实模板和局部断词样式可编译',()=>{
 for(const name of ['src/components/MaterialLibrary.vue','src/views/Resources.vue']){
  const filename=path.resolve(__dirname,'..',name),{descriptor,errors}=sfc.parse(fs.readFileSync(filename,'utf8'),{filename});assert.deepEqual(errors,[]);const script=sfc.compileScript(descriptor,{id:'material-compile'});assert.deepEqual(sfc.compileTemplate({id:'material-compile',source:descriptor.template.content,filename,compilerOptions:{bindingMetadata:script.bindings}}).errors,[]);for(const style of descriptor.styles)assert.deepEqual(sfc.compileStyle({source:style.content,filename,id:'material-compile',scoped:style.scoped}).errors,[]);
 }
});

test('素材跨页选择保留总数，当前页全选只改变当前页，隐藏项保持可见计数',()=>{
 const f=fixture();try{
  f.vm.toggle('asset-0');assert.equal(f.vm.selectedOnPage.value,1);assert.equal(f.vm.selectedElsewhere.value,0);assert(f.vm.partiallySelected.value);assert(!f.vm.allOnPage.value);
  f.vm.page.value=2;assert.deepEqual([...f.vm.selected.value],['asset-0']);assert.equal(f.vm.selectedOnPage.value,0);assert.equal(f.vm.selectedElsewhere.value,1);
  f.vm.selectAll();assert.equal(f.vm.selected.value.length,13);assert.equal(f.vm.selectedOnPage.value,12);assert.equal(f.vm.selectedElsewhere.value,1);assert(f.vm.allOnPage.value);
  f.vm.selectAll();assert.deepEqual([...f.vm.selected.value],['asset-0']);assert.equal(f.vm.selectedElsewhere.value,1);assert(!f.vm.allOnPage.value);
  f.vm.page.value=3;f.vm.selectAll();assert.equal(f.vm.selected.value.length,3);assert.equal(f.vm.selectedOnPage.value,2);assert.equal(f.vm.selectedElsewhere.value,1);
  f.vm.selected.value=[];assert.equal(f.vm.selectedElsewhere.value,0);assert.equal(f.vm.selectedOnPage.value,0);assert.equal(f.calls.length,0);
 }finally{f.dispose();}
});

test('筛选仍按既有语义清选，刷新裁剪已删除ID且不丢存在的跨页选择',async()=>{
 const f=fixture();try{
  f.vm.toggle('asset-0');f.vm.toggle('asset-13');f.vm.page.value=2;
  f.state.value.assets=f.state.value.assets.filter(asset=>asset.id!=='asset-13');await vue.nextTick();assert.deepEqual([...f.vm.selected.value],['asset-0']);assert.equal(f.vm.selectedElsewhere.value,1);
  f.vm.search.value='素材2';await vue.nextTick();assert.equal(f.vm.page.value,1);assert.equal(f.vm.selected.value.length,0);
  f.vm.selectAll();assert(f.vm.selected.value.length);f.vm.filter.value='image';await vue.nextTick();assert.equal(f.vm.selected.value.length,0);
 }finally{f.dispose();}
});

test('资源保存等待使用固定快照，旧请求返回不关闭新编辑会话',async()=>{
 const filename=path.resolve(__dirname,'../src/views/Resources.vue'),{descriptor}=sfc.parse(fs.readFileSync(filename,'utf8'),{filename});
 let release;const gate=new Promise(resolve=>release=resolve),calls=[],studio={state:vue.ref({voices:[],assets:[]}),busy:vue.ref(''),act:async(_,work)=>{await gate;return work();},notify(){},importAssets(){},showDialog(){},refresh(){}};
 const names=['inject','ref','computed','watch','I','Modal','AssetPicker','MediaPreview','ResourceStudio','MaterialLibrary','AccountLibrary','call','mediaUrl'];
 const values=[()=>studio,vue.ref,vue.computed,vue.watch,{},{},{},{},{},{},{},async(action,payload)=>{calls.push({action,payload});return true;},id=>id];
 const code=sfc.compileScript(descriptor,{id:'resource-session'}).content.replace(/^import .*;\r?\n/gm,'').replace('export default','return'),scope=vue.effectScope(),component=new Function(...names,code)(...values),vm=scope.run(()=>component.setup({page:'voices'},{expose(){}}));
 try{vm.editing.value={id:'a',name:'声音A',description:'原描述'};const saving=vm.save();vm.editing.value={id:'b',name:'声音B',description:'新会话'};release();await saving;assert.deepEqual(calls,[{action:'saveResource',payload:{type:'voice',item:{id:'a',name:'声音A',description:'原描述'}}}]);assert.equal(vm.editing.value.id,'b');}finally{scope.stop();}
});
