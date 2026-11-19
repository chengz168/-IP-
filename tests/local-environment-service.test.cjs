const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createService}=require('../server/service.cjs');

// 独立空白数据目录只验证真实服务动作，不启动任何模型或读取用户工作区。
function fixture(t,options={}){const root=fs.mkdtempSync(path.join(os.tmpdir(),'superip-environment-service-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return createService(root,undefined,options);}

test('默认服务不自动拉起本机环境，专用保存只修改启动配置',async t=>{
 const service=fixture(t),before=structuredClone(service.store.data);assert.equal(service.localEnvironment.enabled,false);assert.equal(service.store.localEnvironment,undefined);
 const settings={autoStart:false,comfyRoot:path.join(os.tmpdir(),'comfy'),comfyPython:'',ollamaExecutable:''};await service.invoke('saveLocalEnvironment',{settings});
 const after=structuredClone(service.store.data);assert.deepEqual(after.settings.localEnvironment,settings);delete after.settings.localEnvironment;assert.deepEqual(after,before);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(service.store.root,'studio.json'),'utf8')).settings.localEnvironment,settings);
});

test('启动配置拒绝未知字段、相对路径与活动生成任务',async t=>{
 const service=fixture(t),before=structuredClone(service.store.data);
 for(const settings of [{autoStart:true,command:'任意命令'},{autoStart:'true'},{comfyRoot:'relative/path'}])await assert.rejects(service.invoke('saveLocalEnvironment',{settings}),/无效|开关|完整路径/);
 assert.deepEqual(service.store.data,before);service.store.data.runs.push({id:'active',status:'running'});
 await assert.rejects(service.invoke('saveLocalEnvironment',{settings:{autoStart:false}}),/当前有生成任务/);assert.equal(service.store.data.settings.localEnvironment,undefined);
});

test('启动期间不保存配置；保存落盘失败完整回滚旧设置',async t=>{
 let checking=true;const manager={enabled:true,state:()=>({status:checking?'checking':'ready',checking,services:[]}),start:async()=>{},close(){}};
 const service=fixture(t,{localEnvironment:manager});assert.equal(service.store.localEnvironment,manager);
 await assert.rejects(service.invoke('saveLocalEnvironment',{settings:{autoStart:false}}),/正在检查或启动/);checking=false;
 const before=structuredClone(service.store.data);service.store.save=()=>{throw Error('磁盘写入失败');};await assert.rejects(service.invoke('saveLocalEnvironment',{settings:{autoStart:false}}),/磁盘写入失败/);assert.deepEqual(service.store.data,before);
});

test('环境检查经真实服务动作返回实际状态，桌面桥仅转发白名单配置',async t=>{
 let starts=0;const report={status:'degraded',checking:false,services:[{id:'comfy',status:'failed',message:'路径缺失'}]},manager={enabled:true,state:()=>report,start:async()=>{starts++;return report;},close(){}};
 const service=fixture(t,{localEnvironment:manager});assert.deepEqual(await service.invoke('ensureLocalEnvironment'),report);assert.equal(starts,1);
 let bridge;const calls=[];vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../electron/preload.cjs'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>bridge=value},ipcRenderer:{invoke:async(...args)=>{calls.push(args);return report;}}})});
 for(const action of ['ensureLocalEnvironment','saveLocalEnvironment'])await bridge.invoke(action,{settings:{autoStart:true}});assert.equal(calls.length,2);assert.deepEqual(calls.map(row=>row[1]),['ensureLocalEnvironment','saveLocalEnvironment']);await assert.rejects(bridge.invoke('executeShell',{command:'任意命令'}),/不支持/);
});
