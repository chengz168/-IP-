const {test}=require('node:test'),assert=require('node:assert/strict');
const draft=()=>({id:'task',video:{assetId:'video'},edit:{captions:[{start:0,end:1,text:'第一句',pipId:'image'},{start:2,end:3,text:'第二句'}]}});

test('临时字幕与任务分离，取消重开复用；任务、视频、外部字幕变化均重建',async()=>{
 const {openCaptionSession}=await import('../src/caption-edit-session.mjs');const d=draft(),before=structuredClone(d),session=openCaptionSession(null,d);session.rows[0].text='临时改字';
 assert.deepEqual(d,before);assert.equal(openCaptionSession(session,d),session);
 for(const change of [d=>d.id='other',d=>d.video.assetId='other',d=>d.edit.captions[0].text='外部新字幕']){const next=structuredClone(d);change(next);assert.notEqual(openCaptionSession(session,next),session);}
});
test('确认保存写回完整行，失败恢复任务而临时内容可重试，过期会话拒绝提交',async()=>{
 const {openCaptionSession,saveCaptionSession}=await import('../src/caption-edit-session.mjs'),d={value:draft()},session=openCaptionSession(null,d.value);session.rows[0].text='已修改';let count=0;
 await assert.rejects(saveCaptionSession({session,draft:d,save:async()=>{count++;throw Error('写盘失败');}}),/写盘失败/);assert.equal(d.value.edit.captions[0].text,'第一句');assert.equal(session.rows[0].text,'已修改');
 await saveCaptionSession({session,draft:d,save:async()=>{count++;}});assert.equal(count,2);assert.equal(d.value.edit.captions[0].pipId,'image');assert.equal(d.value.edit.captions[0].text,'已修改');assert.equal(openCaptionSession(session,d.value),session);
 d.value.edit.captions[0].text='外部变化';await assert.rejects(saveCaptionSession({session,draft:d,save:async()=>assert.fail()}),/已变化/);
});
test('相邻无间隙仍插入50毫秒，末尾一秒，已有行和素材不平移，最后行删除保护',async()=>{
 const {insertCaption,deleteCaption}=await import('../src/caption-edit-rules.mjs'),rows=draft().edit.captions;rows[1].start=1;const next=structuredClone(rows[1]);insertCaption(rows,0);assert.deepEqual(rows[1],{start:1,end:1.05,text:''});assert.deepEqual(rows[2],next);assert.equal(rows[0].pipId,'image');insertCaption(rows,2);assert.deepEqual(rows[3],{start:3,end:4,text:''});
 while(rows.length>1)deleteCaption(rows,0);const last=structuredClone(rows);deleteCaption(rows,0);assert.deepEqual(rows,last);
});
test('开始时间受前行和最短时长限制，结束时间修改量逐次平移所有后续行',async()=>{
 const {changeCaptionStart,changeCaptionEnd}=await import('../src/caption-edit-rules.mjs'),rows=draft().edit.captions;changeCaptionStart(rows,1,.2);assert.equal(rows[1].start,1);changeCaptionStart(rows,1,9);assert.equal(rows[1].start,2.95);
 rows[1].start=2;changeCaptionEnd(rows,0,1.5,1);assert.deepEqual(rows.map(r=>[r.start,r.end]),[[0,1.5],[2.5,3.5]]);changeCaptionEnd(rows,0,1.7,1.5);assert.deepEqual(rows.map(r=>[r.start,r.end]),[[0,1.7],[2.7,3.7]]);changeCaptionEnd(rows,0,-1,1.7);assert.deepEqual(rows.map(r=>[r.start,r.end]),[[0,.05],[1.05,2.05]]);
});
test('文字失焦使用真实ASR字符对齐相邻行，没有快照或没有匹配则保留时间',async()=>{
 const {realignCaptionText}=await import('../src/caption-edit-rules.mjs'),rows=[{start:0,end:1,text:'甲'},{start:1,end:2,text:'乙丙'},{start:2,end:4,text:'丁'}],snapshot={sentences:[{start:0,end:4000,text:'甲乙丙丁'}]};realignCaptionText(rows,1,snapshot);assert.deepEqual(rows.map(r=>[r.start,r.end]),[[0,1],[1,3],[3,4]]);
 const before=structuredClone(rows);realignCaptionText(rows,1,null);assert.deepEqual(rows,before);realignCaptionText(rows,1,{sentences:[{start:0,end:1000,text:'完全不同'}]});assert.deepEqual(rows,before);
});
test('原版文字校时保留Unicode、前后边界和未匹配字符，快照仅取同源成功识别',async()=>{
 const {realignCaptionText,captionAsrSnapshot}=await import('../src/caption-edit-rules.mjs');const rows=[{start:0,end:1,text:'𠮷A'},{start:1,end:2,text:'B？'},{start:2,end:3,text:'C'},{start:3,end:4,text:'D'}];realignCaptionText(rows,1,{sentences:[{start:0,end:4000,text:'𠮷abcd'}]});assert.equal(rows[3].start,3);assert.equal(rows[0].start,0);assert(rows[2].end<=3);
 const d=draft(),good={draftId:d.id,type:'transcribe',status:'succeeded',parameters:{assetId:'video'},output:{segments:[{start:0,end:1,text:'原始识别'}]}};assert.equal(captionAsrSnapshot({runs:[{...good,status:'failed'},{...good,parameters:{assetId:'other'}},good]},d).sentences[0].end,1000);assert.equal(captionAsrSnapshot({runs:[{...good,output:{...good.output,stale:true}}]},d),null);
});
test('字幕弹窗公开字族示意不改保存的真实字体标识和参数',async()=>{
 const {subtitleEditorPreview}=await import('../src/subtitle-editor-preview.mjs'),style={fontId:'font-real-file',fontFamily:'FZCuHeiSongS-B-GB',referenceHeight:1920,fontSize:50,outlineWidth:0,shadowDistance:0,bottomMargin:420,opacity:100,color:'#FFFFFF'},before=structuredClone(style);const css=subtitleEditorPreview(style);assert.equal(css.fontFamily,'"FZCuHeiSongS-B-GB", "Microsoft YaHei"');assert.deepEqual(style,before);
});
