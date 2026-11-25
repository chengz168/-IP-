const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {SubtitleFonts,readFontNames}=require('../server/subtitle-fonts.cjs');
const {toCustomAss,assColor}=require('../server/custom-subtitles.cjs');
const {Store}=require('../server/store.cjs');
const {createService}=require('./support/licensed-service.cjs');
const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'subtitle-custom-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
const style=async()=>({...((await import('../server/subtitle-style.mjs')).subtitleDefaults),fontId:'font-0123456789abcdef0123'});

test('ASS色序、透明度与非法参数校验',async()=>{
  const {validateSubtitleStyle}=await import('../server/subtitle-style.mjs'),s=await style();
  assert.equal(assColor('#123456',100),'&H00563412');assert.equal(assColor('#FFFFFF',0),'&HFFFFFFFF');assert.equal(assColor('#000000',80),'&H33000000');
  for(const bad of [{color:'#FFF'},{fontFamily:'bad\nStyle: injected'},{fontSize:NaN},{backgroundOpacity:101},{bold:'false'},{fontId:'../../windows'},{bottomMargin:1900}])assert.throws(()=>validateSubtitleStyle({...s,...bad}));
  assert.equal(validateSubtitleStyle({...s,color:'#abcdef',unknown:42}).color,'#ABCDEF');assert.ok(!Object.hasOwn(validateSubtitleStyle({...s,unknown:42}),'unknown'));
});
test('八预设更改颜色、描边和背景，同时保留字号位置',async()=>{
  const {subtitlePresets,presetStyle}=await import('../server/subtitle-style.mjs'),s={...await style(),fontSize:64,bottomMargin:350,bold:true};
  assert.equal(subtitlePresets.length,8);
  const p=subtitlePresets.map(p=>presetStyle(p.id,s,{id:s.fontId,family:'Microsoft YaHei'}));
  assert.deepEqual(p.map(s=>s.outlineEnabled),[true,true,true,true,false,false,false,false]);assert.deepEqual(p.map(s=>s.backgroundEnabled),[false,false,false,false,true,true,true,true]);
  for(const row of p){assert.equal(row.fontSize,64);assert.equal(row.bottomMargin,350);assert.equal(row.bold,false);assert.equal(row.shadowEnabled,false);}
});
test('旧横竖视频按真实尺寸换算字号，打开样式不改业务字段',async()=>{
  const {fromLegacySubtitle}=await import('../server/subtitle-style.mjs'),edit={subtitleFontSize:48,subtitleMargin:.055,subtitlePosition:'bottom',subtitleStyle:'white'},before=JSON.stringify(edit),font={id:'font-0123456789abcdef0123',family:'Microsoft YaHei'};
  const vertical=fromLegacySubtitle(edit,{width:360,height:640},font),horizontal=fromLegacySubtitle(edit,{width:1920,height:1080},font);
  assert.equal(vertical.fontSize,27);assert.equal(horizontal.fontSize,48*1920/1080);assert.equal(horizontal.referenceHeight,1080);assert.equal(JSON.stringify(edit),before);
});
test('自定义字幕按视频高度缩放，双层背景与独立阴影且时间轴服从倍速',async()=>{
  const s={...await style(),backgroundEnabled:true,outlineEnabled:true,outlineWidth:3,shadowEnabled:true,shadowDistance:4,bold:true,italic:true,underline:true,letterSpacing:2};
  const ass=await toCustomAss([{start:1,end:3,text:'中文{\\an8}\n第二行'}],540,960,s,{speed:2});
  assert.match(ass,/PlayResX: 540/);assert.match(ass,/Style: Background/);assert.match(ass,/Style: Foreground,Microsoft YaHei,44\.444/);assert.match(ass,/,-1,-1,-1,0,100,100,2\.000/);assert.match(ass,/Dialogue: 0,0:00:00.50,0:00:01.50,Background/);assert.match(ass,/Dialogue: 1,0:00:00.50,0:00:01.50,Foreground/);assert.ok(!ass.includes('{\\an8}'));assert.match(ass,/\\N第二行/);
  await assert.rejects(toCustomAss([{start:0,end:1,text:'中'.repeat(300)}],540,960,s),/超出画面/);
  await assert.rejects(toCustomAss([{start:1,end:0,text:'错'}],540,960,s),/字幕时间/);
});
test('解析真实系统TTC字体、目录白名单和字体缺失',t=>{
  const store=new Store(fixture(t)),fonts=new SubtitleFonts(store),rows=fonts.catalog(),yahei=rows.find(f=>f.family==='Microsoft YaHei');
  assert.ok(yahei);assert.ok(readFontNames(fs.readFileSync(yahei.file)).some(f=>f.family==='Microsoft YaHei'));assert.equal(fonts.list().find(f=>f.id===yahei.id).file,undefined);assert.equal(fonts.resolve({fontId:yahei.id,fontFamily:yahei.family}).file,yahei.file);
  assert.throws(()=>fonts.resolve({fontId:'font-00000000000000000000',fontFamily:'missing'}),/字体已缺失/);assert.throws(()=>fonts.resolve({fontId:yahei.id,fontFamily:'wrong'}),/标识与名称不一致/);
  store.data.settings.subtitleFontsDir=path.join(store.root,'missing');assert.throws(()=>fonts.list(),/目录不存在/);
});
test('旧任务未确认不注入自定义字段，确认后失效结果并可刷新，保存失败回滚',async t=>{
  const service=createService(fixture(t)),before=JSON.stringify(service.store.draft()),font=(await service.invoke('listSubtitleFonts')).find(f=>f.family==='Microsoft YaHei');
  const {fromLegacySubtitle}=await import('../server/subtitle-style.mjs');
  fromLegacySubtitle(service.store.draft().edit,undefined,font);assert.equal(JSON.stringify(service.store.draft()),before);assert.ok(!Object.hasOwn(service.store.draft().edit,'subtitleCustom'));
  const d=service.store.draft();d.edit.resultId='old';d.publish.videoId='old';d.publish.recordId='export';service.store.save();
  const s={...await style(),fontId:font.id,fontFamily:font.family};await service.invoke('saveSubtitleStyle',{id:d.id,style:s});
  assert.equal(service.store.draft().edit.resultId,'');assert.equal(service.store.draft().publish.videoId,'');assert.equal(service.store.draft().publish.recordId,'');assert.deepEqual(new Store(service.store.root).draft().edit.subtitleCustom,s);
  const baseline=structuredClone(service.store.draft()),persist=service.store.save;service.store.save=()=>{throw new Error('写入失败');};
  await assert.rejects(service.invoke('saveSubtitleStyle',{id:d.id,style:{...s,bold:true}}),/写入失败/);assert.deepEqual(service.store.draft(),baseline);service.store.save=persist;
});
