const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createVoiceDropImporter,maxVoiceBytes}=require('../electron/voice-drop.cjs');

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'voice-drop-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const mainFrame={},webContents={mainFrame},event={sender:webContents,senderFrame:mainFrame},imports=[];
  const importer=createVoiceDropImporter({window:()=>({webContents}),service:{importPath:async file=>{imports.push(file);return{id:'voice-drop-asset',name:path.basename(file),size:fs.statSync(file).size,path:file};}}});
  const file=(name,bytes)=>{const target=path.join(root,name);fs.writeFileSync(target,bytes);return target;};
  return{root,event,imports,importer,file};
}

test('原生拖放桥接使用 webUtils 解析 File，传入路径后隐藏素材的本机路径',async t=>{
  const f=fixture(t),source=f.file('桌面声音.M4A',Buffer.from('fixture')),nativeFile={native:true};let bridge,parsed;
  const preload=fs.readFileSync(path.join(__dirname,'../electron/preload.cjs'),'utf8');
  vm.runInNewContext(preload,{require:name=>{assert.equal(name,'electron');return{contextBridge:{exposeInMainWorld:(_name,value)=>{bridge=value;}},webUtils:{getPathForFile:file=>{parsed=file;if(file!==nativeFile)throw Error('不是 File');return source;}},ipcRenderer:{invoke:(channel,file)=>{assert.equal(channel,'studio:dropVoice');return f.importer(f.event,file);}}};}});
  const asset=await bridge.importDroppedVoice(nativeFile);
  assert.equal(parsed,nativeFile);assert.deepEqual(f.imports,[source]);assert.equal(asset.id,'voice-drop-asset');assert.equal(asset.path,undefined);
  assert.throws(()=>bridge.importDroppedVoice(source),/不是 File/);
});

test('主进程拒绝其他窗口、子页面、相对路径、非媒体、文件夹、空文件和超过 50MB 的文件',async t=>{
  const f=fixture(t),source=f.file('声音.wav',Buffer.from('valid'));
  await assert.rejects(f.importer({...f.event,sender:{}},source),/窗口来源无效/);
  await assert.rejects(f.importer({...f.event,senderFrame:{}},source),/窗口来源无效/);
  await assert.rejects(f.importer(f.event,'声音.wav'),/本机路径/);
  await assert.rejects(f.importer(f.event,f.file('资料.txt','content')),/支持的音频或视频/);
  const folder=path.join(f.root,'文件夹.wav');fs.mkdirSync(folder);await assert.rejects(f.importer(f.event,folder),/不能拖入文件夹/);
  await assert.rejects(f.importer(f.event,f.file('空文件.wav','')),/50MB/);
  const large=f.file('过大.wav','');fs.truncateSync(large,maxVoiceBytes+1);await assert.rejects(f.importer(f.event,large),/50MB/);
  assert.equal(f.imports.length,0,'校验不通过不得写入素材库');
  fs.truncateSync(large,maxVoiceBytes);await f.importer(f.event,large);assert.equal(f.imports.length,1,'允许恰好 50MB');
});

test('桌面文件优先走原生路径，浏览器与内存 File 保留字节导入，原生错误不静默降级',async()=>{
  const {importDroppedVoice}=await import('../src/voice-drop.mjs'),file={name:'样本.wav',size:20};let reads=0,imports=0;
  const options={readBase64:async value=>{assert.equal(value,file);reads++;return'YXVkaW8=';},importFile:async value=>{imports++;assert.equal(value.name,file.name);return{id:'browser'};},studio:{importDroppedVoice:()=>Promise.resolve({id:'native'})}};
  assert.equal((await importDroppedVoice([file],options)).id,'native');assert.equal(reads,0);assert.equal(imports,0);
  options.studio.importDroppedVoice=()=>null;assert.equal((await importDroppedVoice([file],options)).id,'browser');
  options.studio.importDroppedVoice=()=>Promise.reject(Error('本机文件已删除'));await assert.rejects(importDroppedVoice([file],options),/已删除/);assert.equal(imports,1);
  await assert.rejects(importDroppedVoice([],options),/每次选择一个/);await assert.rejects(importDroppedVoice([file,file],options),/每次选择一个/);
  await assert.rejects(importDroppedVoice([{name:'危险.exe',size:10}],options),/支持的音频或视频/);
  await assert.rejects(importDroppedVoice([{...file,size:maxVoiceBytes+1}],options),/50MB/);
  await assert.rejects(importDroppedVoice([{...file,size:0}],options),/50MB/);
});
