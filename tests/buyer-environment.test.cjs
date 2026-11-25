const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buyerEnvironment}=require('../server/buyer-environment.cjs');
const {buyerErrorMessage}=require('../server/buyer-errors.cjs');
function fixture(){
 return {store:{data:{settings:{provider:{model:'已有模型',asrProtocol:'local-whisper',ttsProtocol:'indextts-local',avatarProtocol:'musetalk-local'}}}},providers:{test:async()=>({models:['已有模型']}),localAsr:()=>({options:()=>({})})},media:{check:async()=>({})},localEnvironment:{state:()=>({services:[{id:'indextts',status:'on-demand'},{id:'musetalk',status:'on-demand'}]}),descriptors:()=>[],settings:()=>({}),launchSpec:()=>{throw Error('未找到程序');}},subtitleFonts:{list:()=>['字体夹具']}};
}
test('向导逐项复用现有预检，六项状态完整但不冒充实际推理',async()=>{
 const input=fixture(),report=await buyerEnvironment(input);assert.deepEqual(report.items.map(x=>x.id),['text','asr','tts','avatar','media','fonts']);assert(report.items.every(x=>x.status==='ready'&&x.inferenceVerified===false));assert.equal(report.canCreate,true);assert(Number.isFinite(Date.parse(report.checkedAt)));assert.match(report.items.find(x=>x.id==='fonts').guide,/常规设置/);
});
test('仅文案服务就绪可开始，缺失可选能力保留各自指引',async()=>{
 const input=fixture();Object.assign(input.store.data.settings.provider,{asrProtocol:'compatible',ttsProtocol:'compatible',avatarProtocol:'compatible'});input.media.check=async()=>{throw Error('媒体缺失');};input.subtitleFonts.list=()=>[];
 const report=await buyerEnvironment(input);assert.equal(report.canCreate,true);assert(report.items.filter(x=>x.id!=='text').every(x=>x.status==='missing'&&x.guide.length));
});
test('可连接但未安装当前模型不能当作文案就绪',async()=>{
 const input=fixture();input.providers.test=async()=>({models:['其他模型']});const report=await buyerEnvironment(input);assert.equal(report.canCreate,false);assert.equal(report.items[0].status,'missing');assert.match(report.items[0].message,/未查到/);
});
test('连接失败只在已有本地启动配置通过时标可启动，不伪造就绪',async()=>{
 const input=fixture();input.providers.test=async()=>{throw Error('连接失败');};input.localEnvironment.descriptors=()=>[{kind:'ollama',local:true}];input.localEnvironment.launchSpec=()=>({});let report=await buyerEnvironment(input);assert.equal(report.items[0].status,'startable');assert.equal(report.canCreate,false);input.localEnvironment.launchSpec=()=>{throw Error('配置缺失');};report=await buyerEnvironment(input);assert.equal(report.items[0].status,'missing');
});
test('单项ASR或字体文件预检失败不阻止其他能力出结果',async()=>{
 const input=fixture();input.providers.localAsr=()=>({options:()=>{throw Error('模型不存在');}});input.subtitleFonts.list=()=>{throw Error('字体目录不可读');};const report=await buyerEnvironment(input);assert.equal(report.items[1].status,'missing');assert.equal(report.items[5].status,'missing');assert.equal(report.canCreate,true);
});
test('买家错误保留中文可执行提示，过滤路径堆栈和纯技术异常',()=>{
 assert.equal(buyerErrorMessage(new Error('软件未激活，请先输入激活码')),'软件未激活，请先输入激活码');
 for(const value of [undefined,'ENOENT','读取失败 C:\\私有目录\\model.bin','读取失败 \\\\server\\secret','失败\n    at private (main.cjs:23:1)','失败 Traceback:']){const message=buyerErrorMessage(value);assert.match(message,/请检查/);assert(!/C:|server|Traceback|ENOENT|main.cjs/.test(message));}
 assert.equal(buyerErrorMessage('第一行\n请重试'),'第一行 请重试');
});
