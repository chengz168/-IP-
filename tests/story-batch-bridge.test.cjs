const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

test('桌面桥转发单镜头、勾选镜头及多资产生成参数，未知动作继续拒绝',async()=>{
 let bridge;const forwarded=[];
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../electron/preload.cjs'),'utf8'),{require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'studio');bridge=value;}},ipcRenderer:{invoke:async(...args)=>{forwarded.push(args);return true;}}};}});
 const requests=[['extractStoryAssets',{id:'draft',episodeId:'episode',shotId:'single'}],['extractStoryAssets',{id:'draft',episodeId:'episode',shotIds:['one','two']}],['generateStoryImage',{id:'draft',assetId:'single'}],['generateStoryAssetImages',{id:'draft',assetIds:['cat','cup'],instructions:{cat:'自然毛发',cup:'蓝色陶瓷'}}]];
 for(const [action,payload] of requests){assert.equal(await bridge.invoke(action,payload),true);assert.deepEqual(forwarded.at(-1),['studio:invoke',action,payload]);}
 await assert.rejects(bridge.invoke('generateArbitraryAsset',{}),/不支持的操作/);assert.equal(forwarded.length,4);
});
