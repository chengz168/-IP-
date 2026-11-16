const {test}=require('node:test'),assert=require('node:assert/strict');
const draft=()=>({id:'original',sourceUrl:'https://example.test/source',sourceText:'原输入'});
async function fixture(options={}){
 const {runExtractAction}=await import('../src/extract-action.mjs'),value={value:draft()},calls=[],saved=[],notices=[];
 const result=await runExtractAction({draft:value,save:async()=>{saved.push(structuredClone(value.value));await options.save?.(saved.length,value);},act:async(label,work)=>{assert.equal(label,'提取文案');return work();},call:async(action,payload)=>{calls.push({action,payload});return options.call?options.call(value):{text:'真实回包协议夹具正文'};},notify:(message,type)=>notices.push({message,type})},options.asset);
 return {result,value,calls,saved,notices};
}
test('提取成功先保存输入，再即时保存识别正文，保存完成才报成功',async()=>{
 const f=await fixture();assert.equal(f.saved.length,2);assert.equal(f.saved[0].sourceText,'原输入');assert.equal(f.saved[1].sourceText,'真实回包协议夹具正文');assert.equal(f.notices.at(-1).type,'success');assert.equal(f.calls[0].payload.id,'original');
});
test('保存输入失败或保存期间切任务不能向新任务启动识别',async()=>{
 const failure=await fixture({save:()=>{throw Error('磁盘失败夹具');}});assert.equal(failure.calls.length,0);assert.equal(failure.value.value.sourceText,'原输入');assert.equal(failure.notices[0].type,'error');
 const switched=await fixture({save:(count,value)=>{value.value={...draft(),id:'new'};}});assert.equal(switched.calls.length,0);assert.equal(switched.saved.length,1);
});
test('识别期间改字、改链接或切任务均保留当前编辑，迟到结果不保存',async()=>{
 for(const key of ['id','sourceUrl','sourceText']){const f=await fixture({call:value=>{value.value[key]='新输入';return {text:'迟到夹具结果'};}});assert.equal(f.saved.length,1);assert.equal(f.value.value[key],'新输入');assert(!f.notices.some(notice=>notice.type==='success'));}
});
test('正文保存失败保留可见结果并报错，空正文和过期回包不覆盖',async()=>{
 const failure=await fixture({save:count=>{if(count===2)throw Error('写入失败夹具');}});assert.equal(failure.value.value.sourceText,'真实回包协议夹具正文');assert.equal(failure.notices.at(-1).type,'error');assert.match(failure.notices.at(-1).message,/当前文字已保留/);
 for(const result of [{text:' '},{text:'迟到结果',stale:true}]){const f=await fixture({call:()=>result});assert.equal(f.value.value.sourceText,'原输入');assert.equal(f.saved.length,1);}
});
test('导入文本文件走同一保存边界，不冒充音视频识别',async()=>{
 const f=await fixture({asset:{id:'text-id',type:'text'},call:()=>Promise.resolve('导入文本正文')});assert.equal(f.calls[0].action,'assetText');assert.deepEqual(f.calls[0].payload,{id:'text-id'});assert.equal(f.saved[1].sourceText,'导入文本正文');
});
