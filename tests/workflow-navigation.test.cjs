const {test}=require('node:test'),assert=require('node:assert/strict');
const {moveWorkflowStep}=require('../src/workflow-navigation.mjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};

test('步骤导航等待子编辑器保存再卸载，并阻止连续点击产生第二次跳转',async()=>{
 const pending=deferred(),draft={value:{id:'one',step:3}},navigating={value:false};let calls=0;
 const options={draft,navigating,save:async()=>{calls++;if(calls===1)await pending.promise;},notify:()=>assert.fail('不应出现错误')};
 const first=moveWorkflowStep({...options,target:2});
 assert.equal(draft.value.step,3);assert.equal(navigating.value,true);
 assert.equal(await moveWorkflowStep({...options,target:4}),false);assert.equal(calls,1);
 pending.resolve();assert.equal(await first,true);assert.equal(draft.value.step,2);assert.equal(calls,2);assert.equal(navigating.value,false);
});
test('保存失败保留当前步骤和编辑，通知实际错误后允许重试',async()=>{
 const draft={value:{id:'one',step:3,localEdit:'待保存'}},navigating={value:false},messages=[];
 const result=await moveWorkflowStep({target:2,draft,navigating,save:async()=>{throw Error('磁盘不可写');},notify:(message,type)=>messages.push({message,type})});
 assert.equal(result,false);assert.equal(draft.value.step,3);assert.equal(draft.value.localEdit,'待保存');assert.deepEqual(messages,[{message:'磁盘不可写',type:'error'}]);assert.equal(navigating.value,false);
});
test('等待中任务变化不把目标步骤写到其他任务',async()=>{
 const pending=deferred(),draft={value:{id:'one',step:3}},navigating={value:false};let calls=0;
 const moving=moveWorkflowStep({target:2,draft,navigating,save:async()=>{calls++;await pending.promise;},notify:()=>{}});
 draft.value={id:'two',step:0};pending.resolve();assert.equal(await moving,false);assert.equal(draft.value.step,0);assert.equal(calls,1);
});
test('无效或当前步骤不触发保存',async()=>{
 const draft={value:{id:'one',step:3}},navigating={value:false};
 for(const target of [-1,7,1.2,'2',3])assert.equal(await moveWorkflowStep({target,draft,navigating,save:()=>assert.fail('不应保存'),notify:()=>{}}),false);
});

test('保存目标步骤失败时恢复原页面，保留已保存编辑',async()=>{
 const draft={value:{id:'one',step:3,title:'刚保存的分集'}},navigating={value:false},messages=[];let calls=0;
 const result=await moveWorkflowStep({target:4,draft,navigating,save:async()=>{if(++calls===2)throw Error('第二次写盘失败');},notify:message=>messages.push(message)});
 assert.equal(result,false);assert.equal(draft.value.step,3);assert.equal(draft.value.title,'刚保存的分集');assert.deepEqual(messages,['第二次写盘失败']);
});

test('分镜与商品下一步等待当前集交接，不用普通保存将旧视频带入剪辑',async()=>{
 for(const mode of ['story','product']){
  const pending=deferred(),draft={value:{id:'one',step:3,video:{mode},edit:{sourceId:'old'}}},navigating={value:false};let saves=0,handoffs=0;
  const options={target:4,draft,navigating,save:async()=>saves++,notify:()=>assert.fail('不应报错'),handoff:async()=>{handoffs++;await pending.promise;draft.value={...draft.value,step:4,edit:{sourceId:'current-episode'}};return true;}};
  const moving=moveWorkflowStep(options);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(draft.value.step,3);assert.equal(draft.value.edit.sourceId,'old');assert.equal(navigating.value,true);
  assert.equal(await moveWorkflowStep(options),false);assert.equal(handoffs,1);
  pending.resolve();assert.equal(await moving,true);assert.equal(draft.value.edit.sourceId,'current-episode');assert.equal(saves,1);assert.equal(navigating.value,false);
 }
});

test('交接未完成、后台拒绝或入口缺失时保留视频生成和旧剪辑源',async()=>{
 for(const handoff of [async()=>false,async()=>{throw Error('当前集还没有匹配镜头的合成视频');},undefined]){
  const draft={value:{id:'one',step:3,video:{mode:'story'},edit:{sourceId:'old'}}},navigating={value:false},messages=[];
  assert.equal(await moveWorkflowStep({target:4,draft,navigating,handoff,save:async()=>{},notify:message=>messages.push(message)}),false);
  assert.equal(draft.value.step,3);assert.equal(draft.value.edit.sourceId,'old');assert.equal(navigating.value,false);
  if(handoff===undefined)assert.match(messages[0],/交接入口/);
 }
});

test('交接等待中换任务不改变新任务，单形象普通导航不调用分镜交接',async()=>{
 const draft={value:{id:'one',step:3,video:{mode:'story'}}},navigating={value:false};
 assert.equal(await moveWorkflowStep({target:4,draft,navigating,save:async()=>{},notify:()=>{},handoff:async()=>{draft.value={id:'two',step:0};return true;}}),false);assert.equal(draft.value.step,0);
 draft.value={id:'one',step:3,video:{mode:'single'}};let saves=0;
 assert.equal(await moveWorkflowStep({target:4,draft,navigating,save:async()=>saves++,notify:()=>{},handoff:()=>assert.fail('口播不调用分集交接')}),true);assert.equal(saves,2);assert.equal(draft.value.step,4);
});
