const {test}=require('node:test'),assert=require('node:assert/strict');
const {voiceDesignState,voiceDesignMatches}=require('../src/voice-design-state.mjs');
const success=(id,draftId='a')=>({id,type:'voice-design',draftId,status:'succeeded',parameters:{job:{text:'正文'+id,instruct:'描述'+id}},output:{assetId:id}});
const audio=id=>({id,type:'audio',origin:'qwen-voice-design'});
test('后续运行、取消、失败或中断保留本任务上次成功候选',()=>{
 for(const status of ['running','cancelled','failed','interrupted']){
  const prior=success('old'),latest={id:'new',type:'voice-design',draftId:'a',status,parameters:{job:{text:'新正文',instruct:'新描述'}}};
  const selected=voiceDesignState({runs:[latest,prior],assets:[audio('old')]},'a');assert.equal(selected.latest,latest);assert.equal(selected.candidateRun,prior);assert.equal(selected.candidate.id,'old');
  assert.equal(voiceDesignMatches(selected.candidateRun,'新正文','新描述'),false);assert.equal(voiceDesignMatches(selected.candidateRun,'正文old','描述old'),true);
 }
});
test('新成功覆盖候选选择，输入匹配必须跟候选记录对应',()=>{
 const latest=success('new'),selected=voiceDesignState({runs:[latest,success('old')],assets:[audio('old'),audio('new')]},'a');assert.equal(selected.candidateRun,latest);assert.equal(selected.candidate.id,'new');assert.equal(voiceDesignMatches(latest,'正文old','描述old'),false);
});
test('跳过缺失、其他来源、错误类型及缺少输入的成功记录',()=>{
 const missing=success('missing'),foreign=success('foreign'),image=success('image'),noInput={...success('no-input'),parameters:{}},prior=success('old');
 const selected=voiceDesignState({runs:[missing,foreign,image,noInput,prior],assets:[{...audio('foreign'),origin:'import'},{...audio('image'),type:'image'},audio('no-input'),audio('old')]},'a');
 assert.equal(selected.latest,missing);assert.equal(selected.candidateRun,prior);assert.equal(selected.candidate.id,'old');
});
test('其他任务或其他功能成功不能作为当前任务候选',()=>{
 const selected=voiceDesignState({runs:[success('other','b'),{...success('speech'),type:'speech'},success('old')],assets:[audio('other'),audio('speech'),audio('old')]},'a');assert.equal(selected.latest.id,'old');assert.equal(selected.candidate.id,'old');
});
test('没有可用成功时返回空候选，不把错误输入当声音',()=>{
 const latest={id:'failed',type:'voice-design',draftId:'a',status:'failed'};assert.deepEqual(voiceDesignState({runs:[latest],assets:[]},'a'),{latest,candidateRun:null,candidate:null});assert.equal(voiceDesignMatches(null,'',''),false);assert.deepEqual(voiceDesignState(null,'a'),{latest:null,candidateRun:null,candidate:null});
});
