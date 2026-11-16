const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {Store}=require('../server/store.cjs');
const {ensureBuiltinAvatars}=require('../server/builtin-avatars.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'builtin-avatar-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new Store(path.join(root,'workspace')),directory=path.join(root,'catalog');fs.mkdirSync(directory);
 const items=[1,2].map(n=>{const video=n+'.mp4',poster=n+'.jpg';fs.writeFileSync(path.join(directory,video),'视频事务测试夹具'+n);fs.writeFileSync(path.join(directory,poster),'封面事务测试夹具'+n);const hash=name=>crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,name))).digest('hex');return {id:'fixture-'+n,name:'示例'+n,video,poster,videoSha256:hash(video),posterSha256:hash(poster),duration:5,width:100,height:200};});
 fs.writeFileSync(path.join(directory,'catalog.json'),JSON.stringify({version:1,items}));return {store,directory,items};
}

test('可选目录或清单缺失明确返回未安装，原数据及文件不变且后续可安装',t=>{
 const {store,directory}=fixture(t),catalogFile=path.join(directory,'catalog.json'),catalog=fs.readFileSync(catalogFile),before=structuredClone(store.data),saved=fs.readFileSync(store.file);
 for(const target of [path.join(directory,'missing'),directory]){if(target===directory)fs.unlinkSync(catalogFile);assert.deepEqual(ensureBuiltinAvatars(store,target),{added:0,status:'not-installed',message:'未安装可选形象包'});assert.deepEqual(store.data,before);assert.deepEqual(fs.readFileSync(store.file),saved);assert.deepEqual(fs.readdirSync(store.assetDir),[]);}
 fs.writeFileSync(catalogFile,catalog);assert.equal(ensureBuiltinAvatars(store,directory).added,2);
});
test('已导入形象的清单缺失不覆盖用户更名、选择或导入标记',t=>{
 const {store,directory}=fixture(t);ensureBuiltinAvatars(store,directory);store.data.avatars[0].name='用户更名';store.draft().video.avatarId=store.data.avatars[0].id;store.save();const before=structuredClone(store.data),saved=fs.readFileSync(store.file),files=fs.readdirSync(store.assetDir);fs.unlinkSync(path.join(directory,'catalog.json'));
 assert.equal(ensureBuiltinAvatars(store,directory).status,'not-installed');assert.deepEqual(store.data,before);assert.deepEqual(fs.readFileSync(store.file),saved);assert.deepEqual(fs.readdirSync(store.assetDir),files);
});
test('清单损坏和清单存在但媒体缺失继续失败，不伪装未安装',t=>{
 const {store,directory}=fixture(t),file=path.join(directory,'catalog.json'),catalog=fs.readFileSync(file),before=structuredClone(store.data),saved=fs.readFileSync(store.file);fs.writeFileSync(file,'{损坏');assert.throws(()=>ensureBuiltinAvatars(store,directory),SyntaxError);fs.writeFileSync(file,catalog);fs.unlinkSync(path.join(directory,'2.mp4'));assert.throws(()=>ensureBuiltinAvatars(store,directory),{code:'ENOENT'});assert.deepEqual(store.data,before);assert.deepEqual(fs.readFileSync(store.file),saved);assert.deepEqual(fs.readdirSync(store.assetDir),[]);
});
test('清单权限与磁盘读取错误原样抛出',t=>{
 const {store,directory}=fixture(t),file=path.join(directory,'catalog.json'),read=fs.readFileSync,before=structuredClone(store.data);let failure;
 // 定向注入权限错误，不依赖测试进程的系统权限。
 t.mock.method(fs,'readFileSync',function(target,...args){if(target===file)throw failure;return read.call(this,target,...args);});
 for(const code of ['EACCES','EPERM','EIO']){failure=Object.assign(new Error('测试读取失败'),{code});assert.throws(()=>ensureBuiltinAvatars(store,directory),error=>error===failure);}assert.deepEqual(store.data,before);
});

test('旧工作区补齐模板，不改用户形象、任务选择和设置，重启不重复',t=>{
 const {store,directory}=fixture(t);store.data.avatars.push({id:'user-avatar',name:'用户形象'});store.draft().video.avatarId='user-avatar';store.save();const draft=structuredClone(store.draft()),settings=structuredClone(store.data.settings);
 assert.deepEqual(ensureBuiltinAvatars(store,directory),{added:2});assert.equal(store.data.avatars.length,3);assert.equal(store.data.assets.length,4);
 assert.deepEqual(store.draft(),draft);assert.deepEqual(store.data.settings,settings);assert.equal(store.data.avatars[0].name,'用户形象');
 const reloaded=new Store(store.root);assert.deepEqual(ensureBuiltinAvatars(reloaded,directory),{added:0});assert.equal(reloaded.data.avatars.length,3);for(const row of reloaded.data.avatars.slice(1)){assert.equal(reloaded.asset(row.assetId).type,'video');assert.equal(reloaded.asset(row.posterId).type,'image');}
});
test('改名和删除内置形象后重启不复原用户操作',t=>{
 const {store,directory}=fixture(t);ensureBuiltinAvatars(store,directory);store.data.avatars[0].name='用户改名';store.data.avatars.pop();store.save();const reloaded=new Store(store.root);ensureBuiltinAvatars(reloaded,directory);assert.equal(reloaded.data.avatars.length,1);assert.equal(reloaded.data.avatars[0].name,'用户改名');
});
test('内置媒体损坏时先拒绝导入，不留下部分素材和标记',t=>{
 const {store,directory}=fixture(t),before=fs.readFileSync(store.file,'utf8');fs.appendFileSync(path.join(directory,'2.mp4'),'损坏');assert.throws(()=>ensureBuiltinAvatars(store,directory),/校验失败/);assert.equal(fs.readFileSync(store.file,'utf8'),before);assert.equal(store.data.assets.length,0);assert.equal(store.data.avatars.length,0);assert.deepEqual(fs.readdirSync(store.assetDir),[]);
});
test('模板保存失败回滚本批文件和数据，恢复后可重新导入',t=>{
 const {store,directory}=fixture(t),save=store.save.bind(store),before=fs.readFileSync(store.file,'utf8');store.save=()=>{throw Error('测试磁盘写入失败');};assert.throws(()=>ensureBuiltinAvatars(store,directory),/写入失败/);assert.equal(store.data.assets.length,0);assert.equal(store.data.avatars.length,0);assert.equal(store.data.builtinAvatarImports,undefined);assert.deepEqual(fs.readdirSync(store.assetDir),[]);assert.equal(fs.readFileSync(store.file,'utf8'),before);store.save=save;assert.equal(ensureBuiltinAvatars(store,directory).added,2);
});
test('新增模板导入失败保留已导入模板及用户更改',t=>{
 const {store,directory,items}=fixture(t);fs.writeFileSync(path.join(directory,'catalog.json'),JSON.stringify({items:items.slice(0,1)}));ensureBuiltinAvatars(store,directory);const before=structuredClone(store.data);fs.writeFileSync(path.join(directory,'catalog.json'),JSON.stringify({items}));store.save=()=>{throw Error('测试提交失败');};assert.throws(()=>ensureBuiltinAvatars(store,directory),/提交失败/);assert.deepEqual(store.data,before);assert.equal(fs.readdirSync(store.assetDir).length,2);
});
