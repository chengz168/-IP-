const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');

test('未取得单实例锁的进程只退出，不继续安排业务启动',()=>{
 let quits=0,readyCalls=0;
 const app={setName(){},requestSingleInstanceLock:()=>false,quit(){quits++},on(){},whenReady(){readyCalls++;return{then(){return{catch(){}}}}}};
 const electron={app,protocol:{registerSchemesAsPrivileged(){}}};
 const entry=path.resolve(__dirname,'../electron/main.cjs');
 // 按被测试入口解析相对模块，新增主进程模块不应错误地从测试目录加载。
 const entryRequire=createRequire(entry);
 vm.runInNewContext(fs.readFileSync(entry,'utf8'),{require:name=>name==='electron'?electron:name==='../server/asset-response.cjs'?{}:name==='../server/service.cjs'?{}:entryRequire(name),__dirname:path.dirname(entry),process:{argv:[]},console});
 assert.equal(quits,1);assert.equal(readyCalls,0,'失去锁后不能继续进入创建服务和窗口的启动链路');
});
