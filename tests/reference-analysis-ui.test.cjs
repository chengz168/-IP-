const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{ref,computed,watch,nextTick}=require('vue');
const {parse,compileScript,compileTemplate}=require('@vue/compiler-sfc');
const filename=path.resolve(__dirname,'../src/components/ReferenceAnalysis.vue'),{descriptor}=parse(fs.readFileSync(filename,'utf8'),{filename});
const original='如果你也想知道猫咪为什么这样，就从它每天的小动作开始观察。接下来我们用三个真实细节解释原因。';
function report(){return {version:1,source:{url:'https://v.douyin.com/ws7-_Lce-t8/',title:'测试报告',assetId:'video',sha256:'hash',duration:8,basis:'real-transcript'},transcript:{text:original,segments:[{start:0,end:2,text:original.slice(0,20)}]},analysis:{summary:'先提出问题，再逐条解释',hook:{kind:'问题',quote:original.slice(0,20),start:0,end:2,explanation:'原文问题引入'},sections:[],ending:{quote:'解释原因',start:null,end:null},reusableStructure:['提出问题','逐条解释'],uncertainties:['画面未启用']},visual:{status:'disabled',observations:[],limitation:'没有调用视觉模型'},inputSignature:'signature',qualityAccepted:false,stale:false};}
function fixture(options={}){
 const draft=ref({id:'draft',sourceUrl:'7.12 分享 https://v.douyin.com/ws7-_Lce-t8/',sourceText:'保持原有文案',rewrite:'',finalText:'',confirmed:false,wordLimit:'200',language:'中文',template:'default',step:0}),state=ref({assets:[{id:'video',type:'video',name:'本地视频'}],runs:[]}),busy=ref(''),workflowLocked=ref(false),calls=[],refreshes=[],notices=[];
 if(options.history)state.value.runs.push({id:'analysis-1',draftId:'draft',type:'reference-analysis',status:'succeeded',snapshot:{sourceUrl:draft.value.sourceUrl,sourceText:draft.value.sourceText,rewrite:draft.value.rewrite,finalText:draft.value.finalText,confirmed:draft.value.confirmed,wordLimit:draft.value.wordLimit,language:draft.value.language,template:draft.value.template},parameters:{},output:report()});
 const studio={draft,state,busy,workflowLocked,save:options.save||(async()=>{}),notify:(...args)=>notices.push(args),refresh:async replace=>{refreshes.push(replace);if(options.refresh)await options.refresh(state,draft,replace);},act:async(label,work)=>{busy.value=label;try{return await work();}catch{return undefined;}finally{busy.value='';}}};
 const call=async(action,payload)=>{calls.push({action,payload});if(options.call)return options.call(action,payload,{draft,state});if(action==='analyzeReferenceVideo'){const output=report();state.value.runs.unshift({id:'analysis-1',draftId:'draft',type:'reference-analysis',status:'succeeded',snapshot:{sourceUrl:draft.value.sourceUrl},parameters:payload,output});return output;}if(action==='createReferenceScript'){const output={text:'这是根据我自己的主题和事实生成的一份可编辑文案，采用先提出问题、再逐条解释的结构。',sourceRunId:payload.runId,inputSignature:'signature',brief:payload.brief,qualityAccepted:false,stale:false};state.value.runs.unshift({id:'script-1',draftId:'draft',type:'reference-script',status:'succeeded',output});return output;}return true;};
 const source=compileScript(descriptor,{id:'reference-analysis-test'}).content.replace(/^import .*;\r?\n/gm,'').replace('export default','return');
 const component=new Function('computed','inject','ref','watch','onBeforeUnmount','I','AssetPicker','call',source)(computed,()=>studio,ref,watch,()=>{},{},{},call);
 const vm=component.setup({}, {expose(){}});return {vm,draft,state,busy,workflowLocked,calls,refreshes,notices};
}

test('新组件和Workflow真实模板可以编译，视频拆解页签接入唯一',()=>{
 for(const file of [filename,path.resolve(__dirname,'../src/views/Workflow.vue')]){const {descriptor,errors}=parse(fs.readFileSync(file,'utf8'),{filename:file});assert.deepEqual(errors,[]);compileScript(descriptor,{id:file});assert.deepEqual(compileTemplate({id:file,source:descriptor.template.content,filename:file}).errors,[]);}
 const workflow=fs.readFileSync(path.resolve(__dirname,'../src/views/Workflow.vue'),'utf8');assert.equal((workflow.match(/import ReferenceAnalysis/g)||[]).length,1);assert.match(workflow,/\['ref-analysis','视频拆解'\]/);
});

test('默认只拆文案，保存来源后调用真实解析接口，不覆盖旧文案',async()=>{
 let saves=0;const {vm,calls,draft}=fixture({save:async()=>{saves++;}});assert.equal(vm.includeVisual.value,false);await vm.analyze();assert.equal(saves,1);assert.deepEqual(calls[0],{action:'analyzeReferenceVideo',payload:{id:'draft',assetId:undefined,includeVisual:false}});assert.equal(vm.currentReportRunId.value,'analysis-1');assert.equal(vm.sourceScript.value,original);assert.equal(draft.value.sourceText,'保持原有文案');assert.equal(vm.sourceStale.value,false);
});

test('历史报告恢复原始脚本，分享文本与已解析URL不误判失效',()=>{
 const {vm}=fixture({history:true});assert.equal(vm.currentReportRunId.value,'analysis-1');assert.equal(vm.sourceScript.value,original);assert.equal(vm.sourceStale.value,false);assert.equal(vm.canUseScript.value,true);assert.equal(vm.currentReport.value.visual.status,'disabled');
});

test('来源变化后旧报告只读，选用请求不会发送',async()=>{
 const {vm,draft,calls}=fixture({history:true});draft.value.sourceUrl='https://example.com/new';assert.equal(vm.sourceStale.value,true);await vm.useScript();assert.equal(calls.length,0);assert.equal(draft.value.sourceText,'保持原有文案');
});

test('签名字段变化会在选用前使旧报告失效，不计算客户端哈希',()=>{
 const source=fixture({history:true});source.draft.value.sourceText='新的原文';assert.equal(source.vm.sourceStale.value,true);
 const final=fixture({history:true});final.draft.value.finalText='新的最终文案';assert.equal(final.vm.sourceStale.value,true);
});

test('生成创作稿、编辑、后端选用后强制刷新，不在前端写sourceText',async()=>{
 const {vm,draft,calls,refreshes}=fixture({history:true});vm.brief.value='我自己的猫咪观察事实';await vm.createScript();assert.equal(vm.createdRunId.value,'script-1');vm.createdScript.value='这是经人工核对并编辑过的创作稿，内容基于我自己的观察事实，保留问题引入和逐条解释的写法。';await vm.useScript();assert.deepEqual(calls.at(-1),{action:'useReferenceScript',payload:{id:'draft',runId:'script-1',kind:'created',text:vm.createdScript.value}});assert.equal(refreshes.at(-1),true);assert.equal(draft.value.sourceText,'保持原有文案');assert.equal(draft.value.step,0);
});

test('原始脚本编辑后通过后端选用，不混用创作任务ID',async()=>{
 const {vm,calls,refreshes}=fixture({history:true});vm.sourceScript.value='这是一份经过人工修正的原始视频脚本，足够二十字，且没有自动修改当前任务原文案。';await vm.useScript();assert.equal(calls[0].action,'useReferenceScript');assert.equal(calls[0].payload.kind,'transcript');assert.equal(calls[0].payload.runId,'analysis-1');assert.equal(refreshes.at(-1),true);
});

test('本地可选音视频，图片拒绝，解析传明确assetId',async()=>{
 const {vm,calls}=fixture();vm.chooseLocal({id:'image',type:'image'});assert.equal(vm.localAsset.value,null);assert.match(vm.error.value,/请选择音频或视频/);vm.chooseLocal({id:'video',type:'video',name:'本地视频'});vm.includeVisual.value=true;await vm.analyze();assert.equal(calls[0].payload.assetId,'video');assert.equal(calls[0].payload.includeVisual,true);
});

test('解析失败保留服务错误与旧文案，忙碌工作流锁阻止重复',async()=>{
 const {vm,calls,busy,workflowLocked,draft}=fixture({call:async()=>{throw Error('平台链接无法静默获取');}});await vm.analyze();assert.match(vm.error.value,/平台链接无法静默获取/);assert.equal(draft.value.sourceText,'保持原有文案');busy.value='其他任务';await vm.analyze();busy.value='';workflowLocked.value=true;await vm.analyze();assert.equal(calls.length,1);
});

test('立即停止主动刷新取得原任务ID，取消不当作成功',async()=>{
 const {vm,calls}=fixture({refresh:async state=>{state.value.runs=[{id:'actual-run',draftId:'draft',type:'reference-analysis',status:'running'}];}});await vm.stop();assert.deepEqual(calls,[{action:'cancelRun',payload:{id:'actual-run'}}]);assert.equal(vm.stopRequested.value,true);assert.equal(vm.currentReport.value,null);
});

test('迟到解析结果与任务切换不能覆盖当前报告',async()=>{
 let finish;const waiting=new Promise(resolve=>{finish=resolve;});const {vm,draft}=fixture({call:async()=>waiting});const work=vm.analyze();await nextTick();draft.value.sourceUrl='新来源';finish(report());await work;assert.equal(vm.currentReport.value,null);assert.match(vm.error.value,/来源已变化/);assert.equal(draft.value.sourceText,'保持原有文案');
});

test('历史创作稿可恢复，不确定时间不伪造成0秒',()=>{
 const {vm,state}=fixture({history:true});state.value.runs.unshift({id:'created-old',draftId:'draft',type:'reference-script',status:'succeeded',output:{text:'过去生成的一份创作稿，重新恢复后仍需要人工核对，不能自动确认。',sourceRunId:'analysis-1',brief:'观察猫咪'}});assert.equal(vm.historicalScripts.value.length,1);vm.restoreScript(vm.historicalScripts.value[0]);assert.equal(vm.createdRunId.value,'created-old');assert.equal(vm.scriptMode.value,'created');assert.equal(vm.timeLabel(null,undefined),'时间未确定 — 时间未确定');
});

test('音乐画面报告优先编辑画面草案，原音轨歌词不冒充旁白，后端用outline选用',async()=>{
 const {vm,state,calls,notices}=fixture({history:true});const base=state.value.runs[0],visual={...base.output,analysis:{...base.output.analysis,contentType:'music-visual',audioRole:'背景音乐及歌词，不承担旁白',hook:{kind:'画面反差',quote:'',basis:'visual',explanation:'猫咪从纸箱中探出头',start:0,end:2}},outline:{text:'开头展示猫咪从纸箱中探出头，中段观察它移动和停顿的动作，结尾回到安静观察的状态。画面未覆盖部分仍需核对。',basis:'visual-analysis'}};vm.restoreReport({...vm.historicalReports.value[0],output:visual});assert.equal(vm.hasOutline.value,true);assert.equal(vm.sourceScript.value,visual.outline.text);assert.equal(vm.sourceScriptLabel.value,'画面脚本（分析草案，可编辑）');assert.equal(vm.contentTypeLabel.value,'音乐与画面叙事');assert.equal(vm.audioRoleLabel.value,'背景音乐及歌词，不承担旁白');assert.equal(vm.currentReport.value.transcript.text,original);assert.equal(vm.basisLabel('visual'),'实际采样画面');await vm.useScript();assert.equal(calls.at(-1).payload.kind,'outline');assert.equal(calls.at(-1).payload.runId,'analysis-1');assert.equal(calls.at(-1).payload.text,visual.outline.text);assert.match(notices[0][0],/画面脚本草案/);
});

test('真实来源和观察状态用中文，未知状态保留，画面采样与音轨时间分别说明',()=>{
 const {vm}=fixture();assert.equal(vm.basisLabel('none'),'未识别可靠依据');assert.equal(vm.sourceBasisLabel('video'),'视频文件');assert.equal(vm.sourceBasisLabel('audio'),'音频文件');assert.equal(vm.visualStatusLabel('succeeded'),'已完成采样观察');assert.equal(vm.visualStatusLabel('unconfigured'),'未配置视觉模型');
 for(const [name,value] of [['basisLabel','new-basis'],['sourceBasisLabel','new-source'],['visualStatusLabel','new-status']])assert.equal(vm[name](value),value);
 assert.equal(vm.structureTimeLabel({basis:'visual',start:1.25,end:3.5}),'采样范围：1.25s — 3.50s');assert.equal(vm.structureTimeLabel({basis:'transcript',start:1.25,end:3.5}),'1.25s — 3.50s');
 assert.match(descriptor.template.content,/音轨识别未提供有效逐句时间轴/);assert.match(descriptor.template.content,/不代表镜头切换边界/);assert.match(descriptor.template.content,/采样点/);assert.match(descriptor.template.content,/sourceBasisLabel\(currentReport.source\?\.basis\)/);assert.match(descriptor.template.content,/visualStatusLabel\(currentReport.visual\?\.status\)/);
});
