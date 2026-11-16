const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const os=require('node:os');

module.exports=async function verifyLocalAsr(page,phase='setup'){
  const directory=path.resolve('evidence/validation/local-asr'),stateFile=path.resolve('evidence/validation/pip-desktop-workspace/studio.json'),reportFile=path.join(directory,'desktop-report.json');
  const read=()=>JSON.parse(fs.readFileSync(stateFile,'utf8'));
  const report=fs.existsSync(reportFile)?JSON.parse(fs.readFileSync(reportFile,'utf8')):{checkedAt:new Date().toISOString(),assertions:[],pageErrors:[]};
  if(report.error){report.previousFailures=report.previousFailures||[];report.previousFailures.push(report.error);delete report.error;}
  const errors=[];const onError=e=>errors.push(e.message);page.on('pageerror',onError);
  const draft=()=>read().drafts.find(d=>d.id===read().currentId);
  const run=(type)=>read().runs.find(r=>r.draftId===report.draftId&&r.type===type);
  async function until(check,label,timeout=30000){const started=Date.now();while(Date.now()-started<timeout){if(await check())return;await new Promise(r=>setTimeout(r,100));}throw new Error('等待实际状态超时：'+label);}
  async function menu(name){await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('navigation',{name:'主菜单'}).getByRole('button',{name,exact:true}).click();}
  const capture=async name=>{await page.mouse.move(700,30);await page.screenshot({path:path.join(directory,name+'.png')});};
  try{
    if(phase==='setup'){
      await menu('设置');await page.locator('.settings-nav').getByRole('button',{name:'模型设置',exact:true}).click();
      await page.getByRole('combobox',{name:'识别接入方式',exact:true}).selectOption('local-whisper');
      await page.getByLabel('Python解释器路径',{exact:true}).fill(path.resolve('.research-venv/Scripts/python.exe'));
      await page.getByLabel('本地Whisper模型目录',{exact:true}).fill('C:/Users/DELL/.cache/whisper/small');
      await page.getByRole('combobox',{name:'识别语言',exact:true}).selectOption('zh');
      await page.getByRole('button',{name:'保存并检查本地模型',exact:true}).click();
      await page.getByRole('dialog',{name:'本地识别模型可用',exact:true}).waitFor({timeout:30000});await capture('settings-model-loaded');await page.keyboard.press('Escape');
      await page.reload();await menu('设置');await page.locator('.settings-nav').getByRole('button',{name:'模型设置',exact:true}).click();
      assert.equal(await page.getByRole('combobox',{name:'识别接入方式',exact:true}).inputValue(),'local-whisper');assert.equal(await page.getByLabel('Python解释器路径',{exact:true}).inputValue(),path.resolve('.research-venv/Scripts/python.exe'));
      report.assertions.push('本地设置真实保存、模型加载、刷新恢复');
      await menu('任务中心');await page.getByRole('button',{name:'新建任务',exact:true}).click();
      report.draftId=read().currentId;await page.getByRole('textbox',{name:'任务名称',exact:true}).fill('本地语音识别真实验收');
      await until(()=>draft().title==='本地语音识别真实验收','临时任务名称保存');
      await page.locator('.main-tabs').getByRole('button',{name:'提取文案',exact:true}).click();
      await page.getByRole('button').filter({hasText:'从音频或视频中提取文案'}).click();
      report.phase='waiting-native-import';
    }
    if(phase==='flows'){
      assert.equal(read().currentId,report.draftId);
      await until(()=>run('extract')?.status==='succeeded','原生导入后真实提取',60000);
      await until(()=>draft().sourceText===run('extract').output.text,'提取文字落盘');
      report.sourceAssetId=run('extract').parameters.assetId;report.extraction=run('extract').output;
      await capture('real-extracted-text');
      report.assertions.push('原生导入视频后本地提取真实文字并保存');
      await page.getByRole('button').filter({hasText:'从音频或视频中提取文案'}).click();
      const picker=page.getByRole('dialog');await picker.getByRole('button').filter({hasText:read().assets.find(a=>a.id===report.sourceAssetId).name}).click();
      await page.getByRole('button',{name:'停止识别',exact:true}).waitFor({timeout:10000});
      await capture('recognition-running-with-stop');await page.getByRole('button',{name:'停止识别',exact:true}).click();
      await until(()=>run('extract')?.status==='cancelled','真实取消本地识别');await until(async()=>await page.locator('.operation-status').count()===0,'操作结束');
      assert.equal(draft().sourceText,report.extraction.text);report.cancelledRun={...run('extract')};
      report.assertions.push('停止真实本地进程，取消记录保留且不覆盖旧文字');
      const text='识别期间手动保留的内容，不应被旧结果覆盖。';
      await page.getByRole('button').filter({hasText:'从音频或视频中提取文案'}).click();await picker.getByRole('button').filter({hasText:read().assets.find(a=>a.id===report.sourceAssetId).name}).click();
      await until(()=>run('extract')?.status==='running','再次开始提取');await page.getByRole('textbox',{name:'原文案',exact:true}).fill(text);
      await until(()=>run('extract')?.status==='succeeded','输入变化后的识别结束',60000);
      await until(async()=>await page.locator('.operation-status').count()===0,'输入保护处理结束');assert.equal(await page.getByRole('textbox',{name:'原文案',exact:true}).inputValue(),text);await until(()=>draft().sourceText===text,'新输入保留');
      await capture('changed-input-preserved');report.assertions.push('识别期间手改原文不被覆盖，真实输出留在执行记录');
      await page.locator('.steps>button').nth(4).click();await page.getByRole('button',{name:'修改',exact:true}).click();await picker.getByRole('button').filter({hasText:read().assets.find(a=>a.id===report.sourceAssetId).name}).click();
      await page.getByRole('button',{name:'生成字幕',exact:true}).click();
      const captions=page.getByRole('dialog',{name:'编辑字幕',exact:true});await captions.waitFor({timeout:60000});
      report.transcription=run('transcribe').output;assert.equal(await captions.locator('.caption-table tbody>tr').count(),report.transcription.segments.length);
      await capture('real-generated-captions');await captions.getByRole('button',{name:'确定',exact:true}).click();
      await until(()=>draft().edit.captions.length===report.transcription.segments.length,'字幕保存');await page.reload();await page.locator('.edit-columns').waitFor();
      assert.deepEqual(draft().edit.captions,report.transcription.segments);
      report.assertions.push('真实生成字幕、确认保存、刷新恢复时间轴');
      await page.getByRole('button',{name:'剪辑视频',exact:true}).click();
      await until(()=>{const value=run('render');if(value?.status==='failed')throw new Error(value.error);return value?.status==='succeeded';},'字幕真实剪辑',90000);
      await until(()=>!!draft().edit.resultId,'剪辑结果回填');report.productId=draft().edit.resultId;
      const video=page.locator('.edit-preview video');await video.evaluate(async element=>{element.muted=true;await element.play();});
      await until(async()=>await video.evaluate(element=>element.currentTime>.7),'真实视频推进播放');await video.evaluate(element=>element.pause());
      report.playback=await video.evaluate(element=>({duration:element.duration,currentTime:element.currentTime,width:element.videoWidth,height:element.videoHeight,error:element.error?.message||''}));
      assert(!report.playback.error);assert(report.playback.currentTime>.7);await capture('real-asr-render-playback');
      report.assertions.push('识别字幕用于真实剪辑，视频播放时间推进且无播放器错误');
      report.tempDirectories=fs.readdirSync(os.tmpdir()).filter(name=>name.startsWith('superip-asr-'));assert.equal(report.tempDirectories.length,0);
      report.runs=read().runs.filter(r=>r.draftId===report.draftId).map(({id,type,status,error,logs})=>({id,type,status,error,logs}));report.phase='flows-passed';
    }
    if(phase==='protect-source'){
      await menu('新工作流');await page.locator('.steps>button').nth(4).click();
      await page.getByRole('button',{name:'编辑字幕',exact:true}).click();
      const captions=page.getByRole('dialog',{name:'编辑字幕',exact:true}),second=captions.getByRole('textbox',{name:'字幕内容',exact:true}).nth(1);
      const corrected=(await second.inputValue()).replace('变迁','便签');await second.fill(corrected);await captions.getByRole('button',{name:'确定',exact:true}).click();
      await until(()=>draft().edit.captions[1]?.text===corrected,'人工校正字幕保存');const previous=JSON.stringify(draft().edit.captions);
      await page.getByRole('button',{name:'生成字幕',exact:true}).click();await until(()=>run('transcribe')?.status==='running','再次真实生成字幕');
      await page.getByRole('button',{name:'修改',exact:true}).click();await page.getByRole('dialog',{name:'选择剪辑视频',exact:true}).getByRole('button').filter({hasText:'画中画验收主视频.mp4'}).click();
      await until(()=>run('transcribe')?.status==='succeeded','换源后的识别完成',60000);await until(async()=>await page.locator('.operation-status').count()===0,'旧结果处理结束');
      assert.equal(await captions.count(),0);assert.equal(JSON.stringify(draft().edit.captions),previous);assert.notEqual(draft().edit.sourceId,report.sourceAssetId);
      report.assertions.push('人工校正便签后保存，识别期间更换视频源不被旧字幕覆盖');report.sourceChangeGuard={currentSourceId:draft().edit.sourceId,recognizedSourceId:run('transcribe').parameters.assetId,captionText:draft().edit.captions[1].text};
      await capture('changed-source-preserved');report.phase='all-ui-checks-passed';
    }
    return {phase:report.phase,draftId:report.draftId,assertions:report.assertions,pageErrors:report.pageErrors};
  }catch(error){report.error=error.message;throw error;}
  finally{page.off('pageerror',onError);report.pageErrors.push(...errors);fs.writeFileSync(reportFile,JSON.stringify(report,null,2));}
};
