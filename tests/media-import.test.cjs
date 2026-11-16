const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createService}=require('../server/service.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'media-import-')),before=new Set(process.listeners('exit')),service=createService(root),listener=process.listeners('exit').find(fn=>!before.has(fn));t.after(()=>{process.removeListener('exit',listener);fs.rmSync(root,{recursive:true,force:true});});return service;}
function file(s,name){const target=path.join(s.store.root,name);fs.writeFileSync(target,'导入契约字节，不是媒体验收');return target;}

test('原生与base64路径共用探测：保存有效时长、纯音轨mp4纠正类型，各只留一个副本',async t=>{
 for(const mode of ['native','base64'])for(const name of ['input.mp4','input.wav','audio-only.mp4']){
  const s=fixture(t),source=file(s,name),bytes=fs.readFileSync(source);let count=0;
  s.media.probe=async target=>{count++;assert.notEqual(target,source);assert.deepEqual(fs.readFileSync(target),bytes);return {format:{duration:'4.125'},streams:[{codec_type:name==='input.mp4'?'video':'audio'}]};};
  const asset=mode==='native'?await s.importPath(source):await s.invoke('importFile',{name,base64:bytes.toString('base64')});
  assert.equal(asset.duration,4.125);assert.equal(asset.type,name==='input.mp4'?'video':'audio');assert.equal(asset.probeError,undefined);assert.equal(count,1);assert.equal(s.store.data.assets.length,1);assert.deepEqual(fs.readdirSync(s.store.assetDir),[path.basename(asset.path)]);assert.deepEqual(fs.readFileSync(source),bytes);assert.equal(JSON.parse(fs.readFileSync(s.store.file)).assets[0].duration,4.125);
 }
});

test('图片和文本导入不触发时长探测，不制造probeError或伪时长',async t=>{
 for(const mode of ['native','base64'])for(const name of ['photo.png','copy.txt']){
  const s=fixture(t),source=file(s,name);s.media.probe=async()=>assert.fail('静态文件不应探测媒体时长');
  const asset=mode==='native'?await s.importPath(source):await s.invoke('importFile',{name,base64:fs.readFileSync(source).toString('base64')});assert.equal(asset.duration,undefined);assert.equal(asset.probeError,undefined);assert.equal(asset.type,name.endsWith('.png')?'image':'text');
 }
});

test('探测失败或无效时长保留可重查的文件并记录错误，不伪造0秒，base64临时文件被清理',async t=>{
 for(const mode of ['native','base64'])for(const duration of ['throw','N/A','0','Infinity']){
  const s=fixture(t),source=file(s,'bad.mp4');s.media.probe=async()=>{if(duration==='throw')throw Error('ffprobe不可用');return {format:{duration},streams:[]};};
  const asset=mode==='native'?await s.importPath(source):await s.invoke('importFile',{name:'bad.mp4',base64:fs.readFileSync(source).toString('base64')});assert.equal(asset.duration,undefined);assert.match(asset.probeError,/ffprobe不可用|有效媒体时长/);assert.equal(fs.existsSync(asset.path),true);assert.deepEqual(fs.readdirSync(s.store.assetDir),[path.basename(asset.path)]);
 }
});

test('原生导入写盘失败不伪装成探测错误，保留原文件',async t=>{
 const s=fixture(t),source=file(s,'input.wav');s.media.probe=async()=>({format:{duration:'1'},streams:[{codec_type:'audio'}]});
 const save=s.store.save.bind(s.store);let calls=0;s.store.save=()=>{if(++calls===2)throw Error('磁盘写入失败');return save();};
 await assert.rejects(s.importPath(source),/磁盘写入失败/);assert.equal(s.store.data.assets[0].probeError,undefined);assert.equal(fs.existsSync(source),true);
});
