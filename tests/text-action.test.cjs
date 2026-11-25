const test=require('node:test'),assert=require('node:assert/strict');
const {createDraft,defaults}=require('../server/store.cjs');

function fixture(){
 const data=defaults(),d=createDraft(),messages=[],dialogs=[],legal=[];
 Object.assign(d,{sourceText:'周六交换旧书。每人最多带5本书，不提供邮寄。',rewrite:'当前手工改写稿',finalText:'已确认的口播正文',confirmed:true});
 data.drafts=[d];data.currentId=d.id;
 const context={draft:{value:d},state:{value:data},save:async()=>{},act:async(label,fn)=>fn(),call:async()=>({text:'模型返回的新改写稿',quality:{status:'needs-review',warnings:['需复核限定条件']}}),notify:(...args)=>messages.push(args),showDialog:(...args)=>dialogs.push(args),showLegal:text=>legal.push(text)};
 return {context,d,data,messages,dialogs,legal};
}
test('明确拒绝的回包不覆盖手工稿、最终稿和确认状态',async()=>{
 const f=fixture(),before=structuredClone(f.d);f.context.call=async()=>({text:'活动提供邮寄。',quality:{status:'rejected',issues:['否定限制反转']}});
 await (await import('../src/text-action.mjs')).runTextAction(f.context,'rewrite');
 assert.deepEqual(f.d,before);assert.match(f.dialogs[0][1],/否定限制反转/);assert.match(f.dialogs[0][1],/当前文案未替换/);assert.equal(f.messages.length,0);
});
test('正常回包写入改写，清除旧确认，复核警告不能当作质量通过',async()=>{
 const f=fixture();await (await import('../src/text-action.mjs')).runTextAction(f.context,'rewrite');
 assert.equal(f.d.rewrite,'模型返回的新改写稿');assert.equal(f.d.finalText,'');assert.equal(f.d.confirmed,false);assert.equal(f.messages[0][1],'warning');assert.match(f.messages[0][0],/需复核限定条件/);
});
test('保存失败不调用生成，也不改变当前稿件',async()=>{
 const f=fixture(),before=structuredClone(f.d);let calls=0;f.context.save=async()=>{throw Error('磁盘只读');};f.context.call=async()=>{calls++;};
 await (await import('../src/text-action.mjs')).runTextAction(f.context,'rewrite');
 assert.equal(calls,0);assert.deepEqual(f.d,before);assert.match(f.messages[0][0],/保存文案失败：磁盘只读/);
});
test('保存期间切换任务不向新任务发起旧请求',async()=>{
 const f=fixture();let calls=0;f.context.save=async()=>{f.context.draft.value=createDraft();};f.context.call=async()=>{calls++;};
 await (await import('../src/text-action.mjs')).runTextAction(f.context,'rewrite');assert.equal(calls,0);
});
for(const change of ['原文','手工稿','模型'])test('等待生成期间修改'+change+'后拒绝迟到覆盖',async()=>{
 const f=fixture();f.context.call=async()=>{if(change==='原文')f.d.sourceText='新的原文';if(change==='手工稿')f.d.rewrite='生成期间手写的新稿';if(change==='模型')f.data.settings.provider.model='另一已配置模型';return{text:'迟到的旧请求结果'};};
 await (await import('../src/text-action.mjs')).runTextAction(f.context,'rewrite');
 assert.equal(f.d.rewrite,change==='手工稿'?'生成期间手写的新稿':'当前手工改写稿');assert.equal(f.d.finalText,'已确认的口播正文');assert.equal(f.d.confirmed,true);assert.match(f.messages[0][0],/未覆盖当前内容/);
});
test('服务端标记过期时保留当前稿件',async()=>{
 const f=fixture(),before=structuredClone(f.d);f.context.call=async()=>({text:'已过期文本',stale:true});await (await import('../src/text-action.mjs')).runTextAction(f.context,'rewrite');assert.deepEqual(f.d,before);
});
test('法务结果进入建议弹窗，不替换文案字段',async()=>{
 const f=fixture(),before=structuredClone(f.d);f.context.call=async()=>({text:'请核对原句中的功能描述。'});await (await import('../src/text-action.mjs')).runTextAction(f.context,'legal');assert.deepEqual(f.d,before);assert.deepEqual(f.legal,['请核对原句中的功能描述。']);
});

test('有效改写在报告返回前立即保存，刷新不依赖自动保存定时器',async()=>{
 const f=fixture(),saved=[];f.context.save=async()=>saved.push(structuredClone(f.context.draft.value));
 const result=await (await import('../src/text-action.mjs')).runTextAction(f.context,'rewrite');
 assert.equal(saved.length,2);assert.equal(saved[0].rewrite,'当前手工改写稿');assert.equal(saved[1].rewrite,result.text);assert.equal(saved[1].confirmed,false);assert.equal(saved[1].finalText,'');
});
test('结果落盘失败保留新编辑与原磁盘稿，并明确报告失败',async()=>{
 const f=fixture();let count=0,persisted;f.context.save=async()=>{if(++count===1){persisted=structuredClone(f.d);return;}throw Error('磁盘只读');};
 await (await import('../src/text-action.mjs')).runTextAction(f.context,'rewrite');
 assert.equal(f.d.rewrite,'模型返回的新改写稿');assert.equal(persisted.rewrite,'当前手工改写稿');assert.equal(f.messages.at(-1)[1],'error');assert.match(f.messages.at(-1)[0],/文案已生成，但保存失败：磁盘只读/);assert.match(f.messages.at(-1)[0],/当前编辑已保留/);
});
test('拒绝、过期及法务回包不触发结果写入',async()=>{
 for(const [kind,result] of [['rewrite',{text:'拒绝结果',quality:{status:'rejected',issues:['限制反转']}}],['rewrite',{text:'过期结果',stale:true}],['legal',{text:'建议'}]]){
  const f=fixture();let saves=0;f.context.save=async()=>saves++;f.context.call=async()=>result;
  await (await import('../src/text-action.mjs')).runTextAction(f.context,kind);assert.equal(saves,1);
 }
});


test('字数偏差超过约定范围时即使没有事实拒绝也不替换当前文案',async()=>{
 const f=fixture(),before=structuredClone(f.d);f.context.call=async()=>({text:'过短的生成稿',quality:{status:'needs-review',targetDeviation:.7,issues:['输出字数与指定字数相差超过20%，请复核']}});
 await (await import('../src/text-action.mjs')).runTextAction(f.context,'rewrite');assert.deepEqual(f.d,before);assert.match(f.dialogs[0][1],/指定字数/);
});
