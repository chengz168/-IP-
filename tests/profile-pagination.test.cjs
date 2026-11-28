const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {VideoParserBrowser}=require('../electron/video-parser-browser.cjs');
const {normalizeProfile,exactPostCount,profileSnapshot}=require('../electron/douyin-profile.cjs');

const url='https://www.douyin.com/user/target_account';
const post=(id,kind='video',author='目标账号')=>({url:'https://www.douyin.com/'+kind+'/'+id,alt:author+'：作品 '+id,title:'作品 '+id});
const snapshot=(posts,extra={})=>({url,name:'目标账号',listPresent:true,posts:posts.map(p=>typeof p==='number'?post(p):p),...extra});
function fixture(snapshots){
 const win=new EventEmitter();let index=0,reads=0,scrolls=0;
 win.isDestroyed=()=>false;win.loadURL=async()=>{};
 win.webContents=Object.assign(new EventEmitter(),{executeJavaScript:async script=>{
  if(script.includes('function scrollProfile(')){scrolls++;index=Math.min(index+1,snapshots.length-1);return {moved:true};}
  assert.match(script,/function profileSnapshot\(/);reads++;return structuredClone(snapshots[index]);
 }});
 const browser=new VideoParserBrowser({});browser.window=win;browser.open=async()=>({open:true});
 return {browser,win,reads:()=>reads,scrolls:()=>scrolls};
}
const options={scope:'all',pollMs:1,timeoutMs:100,stagnantMs:20};

test('浅度兼容只读首屏视频，全量保留可核对作者的图文配文',async()=>{
 const rows=[post(1),post(2,'note'),post(3,'video','其他账号')],sample=fixture([snapshot(rows)]);
 const sampled=await sample.browser.collectProfile(url,{pollMs:1});assert.deepEqual(sampled.posts.map(p=>p.id),['1']);assert.equal(sample.scrolls(),0);
 const all=fixture([snapshot(rows,{endMarker:'没有更多了'})]);const result=await all.browser.collectProfile(url,options);
 assert.deepEqual(result.posts.map(p=>[p.id,p.kind]),[['1','video'],['2','note']]);assert.equal(result.discovery.complete,false);assert.equal(result.discovery.omittedCount,1);assert.equal(result.discovery.reasonCode,'omitted_posts');
});

test('多页与虚拟列表重叠去重，精确作品总数和归属都核对才算完整',async()=>{
 const f=fixture([snapshot([1,2],{totalText:'4',totalConfirmed:true}),snapshot([2,3],{totalText:'4',totalConfirmed:true}),snapshot([3,4],{totalText:'4',totalConfirmed:true})]),pages=[];
 const result=await f.browser.collectProfile(url,{...options,onPage:p=>pages.push(structuredClone(p))});
 assert.deepEqual(result.posts.map(p=>p.id),['1','2','3','4']);assert.equal(result.discovery.complete,true);assert.equal(result.discovery.reportedCount,4);assert.equal(result.discovery.pages,3);assert.equal(result.discovery.reasonCode,'reported_count');
 assert.deepEqual(pages.map(p=>p.discovery.discoveredCount),[2,3,4]);assert.equal(pages[0].discovery.complete,false);assert.equal(pages.at(-1).discovery.complete,true);
});

test('缩写、错误格式和未确认页签的计数不能证明完整',async()=>{
 for(const value of ['1.2万','1万','1.2K','1w','-1','2.0','001','1,00',''])assert.equal(exactPostCount(value),null);
 assert.equal(exactPostCount('1,234'),1234);assert.equal(exactPostCount('0'),0);assert.equal(exactPostCount('48'),48);
 for(const extra of [{totalText:'1'},{totalText:'1.0万',totalConfirmed:true}]){
  const f=fixture([snapshot([1],extra)]),result=await f.browser.collectProfile(url,{...options,maxPages:2});
  assert.equal(result.discovery.complete,false);assert.equal(result.discovery.reportedCount,null);
 }
});

test('只有明确结束标志可在无总数时结束，数量不符与隐藏卡片均保留部分状态',async()=>{
 const clean=fixture([snapshot([1],{endMarker:'没有更多了'})]);assert.equal((await clean.browser.collectProfile(url,options)).discovery.complete,true);
 const mismatch=fixture([snapshot([1],{endMarker:'没有更多了',totalText:'2',totalConfirmed:true})]);const m=await mismatch.browser.collectProfile(url,options);assert.equal(m.discovery.complete,false);assert.equal(m.discovery.reasonCode,'count_mismatch');
 const hidden=fixture([snapshot([1],{endMarker:'没有更多了',unlinkedCount:1})]);const h=await hidden.browser.collectProfile(url,options);assert.equal(h.discovery.complete,false);assert.equal(h.discovery.omittedCount,1);
 const empty=fixture([snapshot([],{endMarker:'暂无作品',totalText:'0',totalConfirmed:true})]);const e=await empty.browser.collectProfile(url,options);assert.equal(e.discovery.complete,true);assert.equal(e.discovery.discoveredCount,0);
});

test('登录和验证码限制优先于末尾或计数，不能谎报整账号成功',async()=>{
 for(const [flag,reasonCode] of [['loginLimited','login_required'],['verificationRequired','verification_required']]){
  const f=fixture([snapshot([1],{[flag]:true,totalText:'1',totalConfirmed:true,endMarker:'没有更多了'})]);const result=await f.browser.collectProfile(url,options);
  assert.equal(result.discovery.complete,false);assert.equal(result.discovery.reasonCode,reasonCode);assert.equal(result.posts.length,1);assert.equal(f.scrolls(),0);
 }
});

test('登录查看更多提示预先渲染也继续读取后续可用页，停滞后才报登录受限',async()=>{
 const f=fixture([snapshot([1],{loginLimited:true,totalText:'4',totalConfirmed:true}),snapshot([2,3],{loginLimited:true,totalText:'4',totalConfirmed:true})]);
 const result=await f.browser.collectProfile(url,{...options,stagnantMs:3});assert.deepEqual(result.posts.map(p=>p.id),['1','2','3']);assert.equal(result.discovery.reasonCode,'login_required');assert.equal(result.discovery.complete,false);assert(f.scrolls()>0);
});

test('作品计数变化和后续账号切换保留可信已发现部分，不合并他人作品',async()=>{
 const changing=fixture([snapshot([1],{totalText:'3',totalConfirmed:true}),snapshot([2],{totalText:'4',totalConfirmed:true})]);const c=await changing.browser.collectProfile(url,options);assert.equal(c.discovery.complete,false);assert.equal(c.discovery.countChanged,true);assert.equal(c.discovery.reasonCode,'count_changed');
 const switched=fixture([snapshot([1]),snapshot([post(2)],{url:url+'other'})]);const s=await switched.browser.collectProfile(url,options);assert.equal(s.discovery.reasonCode,'page_unavailable');assert.equal(s.discovery.complete,false);assert.deepEqual(s.posts.map(p=>p.id),['1']);
});

test('作品数变化后仍读取后续公开作品，占位恢复不永久算遗漏',async()=>{
 const changing=fixture([snapshot([1],{totalText:'5',totalConfirmed:true}),snapshot([2],{totalText:'4',totalConfirmed:true}),snapshot([3,4],{totalText:'4',totalConfirmed:true,endMarker:'没有更多了'})]);
 const result=await changing.browser.collectProfile(url,options);assert.equal(result.posts.length,4);assert.equal(result.discovery.complete,false);assert.equal(result.discovery.reasonCode,'count_changed');
 const loaded=fixture([snapshot([1],{unlinkedCount:1}),snapshot([1,2],{unlinkedCount:0,endMarker:'没有更多了'})]);const r=await loaded.browser.collectProfile(url,options);assert.equal(r.discovery.complete,true);assert.equal(r.discovery.omittedCount,0);
});

test('停滞、翻页预算和数量预算有界退出并准确标记尚未完整',async()=>{
 const stalled=fixture([snapshot([1])]);const s=await stalled.browser.collectProfile(url,{...options,stagnantMs:3});assert.equal(s.discovery.reasonCode,'stalled');assert.equal(s.discovery.complete,false);
 const pageLimited=fixture([snapshot([1]),snapshot([2])]);const p=await pageLimited.browser.collectProfile(url,{...options,maxPages:2});assert.equal(p.discovery.reasonCode,'page_limit');assert.equal(p.posts.length,2);
 const capped=fixture([snapshot([1,2,3])]);const c=await capped.browser.collectProfile(url,{...options,maxPosts:2});assert.equal(c.discovery.reasonCode,'post_limit');assert.equal(c.posts.length,2);assert.equal(c.discovery.complete,false);
 const crossPage=fixture([snapshot([1,2]),snapshot([3,4],{endMarker:'没有更多了'})]);const cp=await crossPage.browser.collectProfile(url,{...options,maxPosts:3});assert.equal(cp.discovery.reasonCode,'post_limit');assert.equal(cp.posts.length,3);assert.equal(cp.discovery.complete,false);
 const timed=fixture([snapshot([1]),snapshot([2])]);const t=await timed.browser.collectProfile(url,{...options,maxDurationMs:1,pollMs:2});assert.equal(t.discovery.reasonCode,'time_limit');assert.equal(t.discovery.complete,false);
});

test('每页先交付检查点，取消立即退出并释放会话，不继续滚动或回调成功',async()=>{
 const controller=new AbortController(),f=fixture([snapshot([1]),snapshot([2],{endMarker:'没有更多了'})]),pages=[];
 await assert.rejects(f.browser.collectProfile(url,{...options,signal:controller.signal,onPage:p=>{pages.push(p);controller.abort();}}),{name:'AbortError'});
 assert.equal(pages.length,1);assert.equal(pages[0].discovery.complete,false);assert.equal(f.scrolls(),0);assert.equal(f.browser.occupied,false);
});

test('停止后的迟到结果以及持久化失败不能继续发现或冒充完成',async()=>{
 const f=fixture([snapshot([1]),snapshot([2])]);await assert.rejects(f.browser.collectProfile(url,{...options,onPage:()=>{throw Error('检查点写入失败');}}),/检查点写入失败/);assert.equal(f.scrolls(),0);assert.equal(f.browser.occupied,false);
 const closed=fixture([snapshot([1]),snapshot([2])]);await assert.rejects(closed.browser.collectProfile(url,{...options,onPage:()=>{closed.browser.generation++;}}),/解析窗口已关闭/);assert.equal(closed.scrolls(),0);
});

test('页面脚本无响应时取消仍能退出，迟到结果不会再调用检查点',async()=>{
 const f=fixture([snapshot([1])]),controller=new AbortController();let finish;
 f.win.webContents.executeJavaScript=()=>new Promise(resolve=>{finish=resolve;});
 let calls=0;const pending=f.browser.collectProfile(url,{...options,signal:controller.signal,onPage:()=>calls++});
 await new Promise(resolve=>setImmediate(resolve));controller.abort();await assert.rejects(pending,{name:'AbortError'});finish(snapshot([1],{endMarker:'没有更多了'}));await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);assert.equal(f.browser.occupied,false);
});

test('作品末尾提示必须来自作品区的独立可见节点，配文与推荐区文字不充当结束证据',()=>{
 const vm=require('node:vm');const textNode=(text,extra={})=>({innerText:text,getClientRects:()=>[{}],closest:()=>null,querySelector:()=>null,...extra});
 const caption=textNode('没有更多了',{closest:()=>({tagName:'A'})}),hidden=textNode('没有更多了',{getClientRects:()=>[]}),end=textNode('没有更多了');
 let candidates=[caption,hidden];const list={querySelectorAll:selector=>selector==='div,span,p'?candidates:[],nextElementSibling:null};
 const root={querySelector:selector=>selector.includes('user-info')?{textContent:'目标账号'}:list,querySelectorAll:()=>[],innerText:''};
 const context={document:{querySelector:()=>root,querySelectorAll:()=>[]},location:{href:url}};
 // 在独立上下文执行真实DOM读取函数，防止后续放宽为整个页面文本搜索。
 let result=vm.runInNewContext('('+profileSnapshot.toString()+')()',context);assert.equal(result.endMarker,'');candidates=[caption,end];result=vm.runInNewContext('('+profileSnapshot.toString()+')()',context);assert.equal(result.endMarker,'没有更多了');
 assert.equal(normalizeProfile(snapshot([1],{totalText:'1'}),url).reportedCount,null);
});
