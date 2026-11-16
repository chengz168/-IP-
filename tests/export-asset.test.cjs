const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {exportAsset}=require('../electron/export-asset.cjs');
function setup(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-export-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const source=path.join(root,'原视频.mp4'),destination=path.join(root,'导出.mp4'),bytes=Buffer.from('独立文件复制测试，不作为真实媒体验收');fs.writeFileSync(source,bytes);
  const asset={id:'video',name:'原视频.mp4',path:source,type:'video'};
  const store={asset(id){assert.equal(id,asset.id);if(!fs.existsSync(source))throw Error('文件不存在或已被移动，请重新导入');return asset;}};
  return {root,source,destination,bytes,asset,store};
}
test('视频导出复制真实字节，正确传递原生标题、默认名和格式，源文件不变',async t=>{
  const s=setup(t);let calls=0;
  const result=await exportAsset({store:s.store,win:'window',dialog:{async showSaveDialog(win,options){calls++;assert.equal(win,'window');assert.equal(options.title,'导出视频');assert.equal(options.defaultPath,'原视频.mp4');assert.deepEqual(options.filters,[{name:'MP4 视频',extensions:['mp4']},{name:'所有文件',extensions:['*']}]);return {filePath:s.destination};}}},'video',{purpose:'video'});
  assert.equal(calls,1);assert.deepEqual(result,{canceled:false,name:'导出.mp4'});assert.deepEqual(fs.readFileSync(s.destination),s.bytes);assert.deepEqual(fs.readFileSync(s.source),s.bytes);
});
test('取消和空路径均不创建文件，也不返回成功',async t=>{
  const s=setup(t);for(const value of [{canceled:true,filePath:s.destination},{canceled:false}])assert.deepEqual(await exportAsset({store:s.store,dialog:{showSaveDialog:async()=>value}},'video',{purpose:'video'}),{canceled:true});
  assert.deepEqual(fs.readdirSync(s.root),['原视频.mp4']);
});
test('同路径另存不截断文件，保存框期间源丢失则失败',async t=>{
  const s=setup(t),dialog={showSaveDialog:async()=>({filePath:s.source})};await exportAsset({store:s.store,dialog},'video',{purpose:'video'});assert.deepEqual(fs.readFileSync(s.source),s.bytes);
  dialog.showSaveDialog=async()=>{fs.unlinkSync(s.source);return {filePath:s.source};};await assert.rejects(exportAsset({store:s.store,dialog},'video',{purpose:'video'}),/文件不存在/);assert.equal(fs.existsSync(s.source),false);
});
test('保存框和复制失败向上传递，允许再次导出',async t=>{
  const s=setup(t),dialog={showSaveDialog:async()=>{throw Error('保存窗口失败');}};await assert.rejects(exportAsset({store:s.store,dialog},'video'),/保存窗口失败/);
  dialog.showSaveDialog=async()=>({filePath:path.join(s.root,'不存在目录','test.mp4')});await assert.rejects(exportAsset({store:s.store,dialog},'video'),{code:'ENOENT'});assert.deepEqual(fs.readFileSync(s.source),s.bytes);
  dialog.showSaveDialog=async()=>({filePath:s.destination});assert.equal((await exportAsset({store:s.store,dialog},'video')).canceled,false);
});
test('封面视频与图片原有导出标题保留，音频不会打开保存框',async t=>{
  const s=setup(t),titles=[],dialog={showSaveDialog:async(_,options)=>{titles.push(options.title);return {canceled:true};}};
  await exportAsset({store:s.store,dialog},'video');s.asset.type='image';await exportAsset({store:s.store,dialog},'video');assert.deepEqual(titles,['导出封面视频','导出封面图片']);
  s.asset.type='audio';await assert.rejects(exportAsset({store:s.store,dialog},'video'),/仅支持/);assert.equal(titles.length,2);
});
