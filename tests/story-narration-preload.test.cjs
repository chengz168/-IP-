const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

test('真实桌面预加载允许旁白对齐调用并拒绝未登记操作',async()=>{
 const calls=[];let studio;
 // 执行实际预加载入口，避免仅测试UI替身而遗漏桌面白名单。
 const electron={contextBridge:{exposeInMainWorld:(name,value)=>{if(name==='studio')studio=value;}},ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve({accepted:true});},send:()=>{}},webUtils:{getPathForFile:()=>''}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../electron/preload.cjs'),'utf8'),{require:name=>{assert.equal(name,'electron');return electron;}},{filename:'preload.cjs'});
 const payload={id:'draft',episodeId:'episode',allowReferenceMapping:true};
 assert.deepEqual(await studio.invoke('alignStoryNarration',payload),{accepted:true});
 assert.equal(calls.length,1);assert.equal(calls[0][0],'studio:invoke');assert.equal(calls[0][1],'alignStoryNarration');assert.equal(calls[0][2],payload);
 await assert.rejects(studio.invoke('unregisteredAction',payload),/不支持的操作/);assert.equal(calls.length,1);
});
