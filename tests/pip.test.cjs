const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pipTimeline,preparePip}=require('../server/pip.cjs');
const {Store}=require('../server/store.cjs');
const base=()=>({pipEnabled:true,pipMode:'captions',speed:1,captions:[]});
test('逐句画中画保留间隙与相邻半开区间，跳过未分配行并从每句开头播放',()=>{
  const edit={...base(),captions:[{start:1,end:2,pipId:'image'},{start:2,end:3,pipId:'video'},{start:3,end:4},{start:5,end:6,pipId:'image'}]};
  const clips=pipTimeline(edit,8,[{start:0,end:8}]);
  assert.deepEqual(clips.map(c=>[c.assetId,c.row,c.start,c.end,c.sourceOffset]),[['image',1,1,2,0],['video',2,2,3,0],['image',4,5,6,0]]);
});
test('画中画跨剪口保留素材偏移，按倍速缩短显示窗口',()=>{
  const edit={...base(),speed:2,captions:[{start:1,end:7,pipId:'video'}]};
  assert.deepEqual(pipTimeline(edit,8,[{start:0,end:2},{start:5,end:8}]),[
    {assetId:'video',row:1,start:.5,end:1,sourceOffset:0,rate:2},
    {assetId:'video',row:1,start:1,end:2,sourceOffset:4,rate:2}
  ]);
});
test('画中画重叠、越界、空配置、被全部裁掉明确失败，关闭时不读取旧分配',()=>{
  assert.deepEqual(pipTimeline({pipEnabled:false},8,[{start:0,end:8}]),[]);
  const edit={...base(),captions:[{start:0,end:3,pipId:'a'},{start:2,end:4,pipId:'b'}]};
  assert.throws(()=>pipTimeline(edit,8,[{start:0,end:8}]),/第1行与第2行.*重叠/);
  assert.throws(()=>pipTimeline({...base(),captions:[{start:7,end:9,pipId:'a'}]},8,[{start:0,end:8}]),/超出/);
  assert.throws(()=>pipTimeline({...base(),captions:[{start:1,end:2}]},8,[{start:0,end:8}]),/分配/);
  assert.throws(()=>pipTimeline({...base(),captions:[{start:1,end:2,pipId:'a'}]},8,[{start:4,end:8}]),/全部位于被裁掉/);
});
test('旧全程模式不受字幕分配影响，保留原正常播放速率',()=>{
  const clips=pipTimeline({pipEnabled:true,pipId:'old',speed:2,captions:[{start:1,end:2,pipId:'other'}]},8,[{start:0,end:2},{start:5,end:8}]);
  assert.deepEqual(clips,[{assetId:'old',row:null,start:0,end:2.5,sourceOffset:0,rate:1}]);
});
test('分配随字幕删除和重排保存，变更使旧剪辑和发布引用失效，旧任务迁移保留模式',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pip-state-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root),d=store.draft();
  delete d.edit.pipMode;d.edit.pipId='old';store.save();const reopened=new Store(root);
  assert.equal(reopened.draft().edit.pipMode,'continuous');assert.equal(reopened.draft().edit.pipId,'old');
  const current=reopened.draft();current.edit.captions=[{start:0,end:1,text:'甲',pipId:'a'},{start:1,end:2,text:'乙',pipId:'b'}];current.edit.resultId='edited';current.publish.videoId='edited';reopened.save();
  const next=structuredClone(current);next.edit.pipMode='captions';next.edit.captions.splice(0,1);reopened.updateDraft(next);
  const saved=new Store(root).draft();assert.deepEqual(saved.edit.captions,[{start:1,end:2,text:'乙',pipId:'b'}]);assert.equal(saved.edit.resultId,'');assert.equal(saved.publish.videoId,'');
});
test('素材读取失败、不含画面、超高尺寸会明确拒绝',async()=>{
  const edit={...base(),pipSize:.7,captions:[{start:0,end:1,pipId:'a'}]},stream={width:1080,height:1920},keep=[{start:0,end:3}];
  await assert.rejects(preparePip({store:{asset:()=>{throw new Error('文件不存在');}}},edit,3,keep,stream),/文件不存在/);
  const media={store:{asset:()=>({type:'image',path:'unused'})},probe:async()=>({streams:[]})};
  await assert.rejects(preparePip(media,edit,3,keep,stream),/有效画面/);
  media.probe=async()=>({streams:[{codec_type:'video',width:10,height:100}]});
  await assert.rejects(preparePip(media,edit,3,keep,stream),/过高/);
});
