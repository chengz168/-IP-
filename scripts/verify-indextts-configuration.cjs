const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const directory=path.resolve('evidence/validation/indextts-generation'),inputs=JSON.parse(fs.readFileSync(path.join(directory,'inputs.json'),'utf8'));
async function main(){
 const b=await chromium.connectOverCDP('http://127.0.0.1:9342'),p=b.contexts()[0].pages()[0],errors=[];p.on('pageerror',error=>errors.push(error.message));
 const call=(action,payload)=>p.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload});
 const report={at:new Date().toISOString(),pageErrors:errors,newInference:false,steps:[]};
 try{
  await p.locator('.voice-config').waitFor();
  const generate=p.getByRole('button',{name:'生成声音',exact:true}),voice=p.getByRole('combobox',{name:'选择声音',exact:true});
  await voice.click();await p.getByRole('option',{name:'请选择本地参考声音',exact:true}).click();assert(await generate.isDisabled());report.steps.push('清空样本后禁止生成');
  await voice.click();await p.getByRole('option',{name:'合成声音参考（本地样本）',exact:true}).click();assert(await generate.isEnabled());
  report.steps.push('真实选择无远程ID的本地样本后可生成');
  await p.getByRole('button',{name:'高级设置',exact:true}).click();
  const emotion=p.getByRole('combobox',{name:'情绪类型',exact:true}),strength=p.getByRole('spinbutton',{name:'情绪强度',exact:true}),speed=p.getByRole('slider',{name:'声音语速',exact:true});
  assert(await strength.isDisabled());await emotion.click();await p.getByRole('option',{name:'高兴',exact:true}).click();assert(await strength.isEnabled());await strength.fill('0.7');
  await speed.focus();await speed.press('Home');for(let i=0;i<14;i++)await speed.press('ArrowRight');assert.equal(await speed.inputValue(),'1.2');
  await p.screenshot({path:path.join(directory,'configuration-happy-speed.png')});report.steps.push('高兴情绪强度0.7、键盘调整语速1.2');
  await emotion.click();await p.getByRole('option',{name:'正常',exact:true}).click();assert(await strength.isDisabled());
  await speed.focus();await speed.press('Home');for(let i=0;i<10;i++)await speed.press('ArrowRight');
  for(let i=0;i<80;i++){const state=await call('state'),draft=state.drafts.find(item=>item.id===inputs.draftId);if(draft.voice.profile===inputs.voice.id&&draft.voice.speed===1&&draft.voice.emotion===''){report.savedDraft=draft;break;}await new Promise(resolve=>setTimeout(resolve,100));}
  assert(report.savedDraft);await p.reload();await p.locator('.voice-config').waitFor();
  const after=await call('state');assert.equal(after.runs.length,0);assert.equal(after.drafts.find(item=>item.id===inputs.draftId).voice.profile,inputs.voice.id);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(inputs.reference.path)).digest('hex'),inputs.reference.sha256);
  await p.screenshot({path:path.join(directory,'configuration-normal.png')});report.refreshPreserved=true;report.steps.push('恢复正常语速及情绪，刷新保留选择且未创建生成记录');assert.deepEqual(errors,[]);
 }catch(error){report.error=error.stack;throw error;}
 finally{fs.writeFileSync(path.join(directory,'configuration.json'),JSON.stringify(report,null,2));await b.close();}
 console.log(JSON.stringify({steps:report.steps,pageErrors:errors}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
