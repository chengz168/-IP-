const test=require('node:test'),assert=require('node:assert/strict');
const {classifyProductPage,browserUserAgent,snapshotScript}=require('../electron/product-browser.cjs');

test('有真实商品的APP价格提示和扫码入口不判为阻断，明确验证仍须停止',()=>{
 for(const text of ['Hi，前往抖音APP 可查看完整价格','请使用抖音APP扫码查看完整价格','商品服务：安全验证保障交易'])assert.deepEqual(classifyProductPage({text,hasImages:true,hasProduct:true}),{restricted:false,restriction:'',ready:true});
 for(const text of ['请完成安全验证','检测到当前环境存在安全风险，请进入抖音查看商品详情','请先登录后继续','请使用抖音APP扫码或 点此进入抖音查看商品信息']){
  const result=classifyProductPage({text,hasImages:true,hasProduct:false});assert.equal(result.restricted,true);assert.equal(result.ready,false);assert.ok(result.restriction);
 }
 assert.equal(classifyProductPage({text:'检测到当前环境存在安全风险',hasImages:true,hasProduct:true}).ready,false);
 assert.equal(classifyProductPage({text:'空白加载中',hasImages:false,hasProduct:false}).ready,false);
});

test('网页兼容UA保留本机Chrome平台版本，移除应用标记，不借用账号身份',()=>{
 const source='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 super-ip-studio/0.1.0 Chrome/144.0.0.0 Electron/40.10.6 Safari/537.36';
 const actual=browserUserAgent(source);assert.equal(actual,'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/144.0.0.0 Safari/537.36');
 assert.equal(browserUserAgent(actual),actual);assert.match(actual,/Windows NT 10.0/);assert.match(actual,/Chrome\/144/);
});

test('真实页面快照脚本识别背景商品图，返回可查限制词，不读取Cookie',()=>{
 const vm=require('node:vm');
 const context={document:{body:{innerText:'打开抖音APP\n羽毛玩具\n请使用抖音APP扫码查看价格\n加入购物车'},title:'商品',images:[],querySelectorAll:selector=>selector==='script[type="application/ld+json"]'?[]:selector==='.head-figure__media-view__content'?[{}]:[{innerText:'彩色羽毛逗猫棒'}]},getComputedStyle:()=>({backgroundImage:'url("https://cdn.example.com/product.jpg")'})};
 const snapshot=vm.runInNewContext(snapshotScript,context);assert.equal(snapshot.ready,true);assert.equal(snapshot.images.length,1);assert.equal(snapshot.restricted,false);
 context.document.body.innerText='检测到当前环境存在安全风险';const blocked=vm.runInNewContext(snapshotScript,context);assert.equal(blocked.ready,false);assert.equal(blocked.restriction,'检测到当前环境存在安全风险');
 assert.doesNotMatch(snapshotScript,/document\.cookie|localStorage|sessionStorage/);
});
