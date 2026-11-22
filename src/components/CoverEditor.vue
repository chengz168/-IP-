<script setup>
import {inject,ref,watch,onMounted,onUnmounted,nextTick,computed} from 'vue';
import I from './Icon.vue';
import Modal from './Modal.vue';
import CoverTextProperties from './CoverTextProperties.vue';
import CoverMaskProperties from './CoverMaskProperties.vue';
import CoverRange from './CoverRange.vue';
import {call,mediaUrl} from '../api';
import {coverTemplates,coverScene,templateScene,textStyle,templateId,coverSignature,hitLayer,localPoint,validScene,coverFormats,formatForVideo,resizeCoverScene} from '../cover-model.mjs';
import {drawCover} from '../cover-render.mjs';
import {prepareCoverFonts} from '../cover-fonts.mjs';
import {recoverMissingCoverFonts} from '../cover-font-recovery.mjs';
import {loadingThumbnails,renderThumbnails} from '../cover-thumbnails.mjs';
import {downstreamText} from '../../server/story-source.mjs';
const emit=defineEmits(['choose']);
const {draft:d,state,busy,act,notify}=inject('studio');
const canvas=ref(),stack=ref(),canvasViewport=ref(),inlineEditor=ref(),video=ref(),tab=ref('templates'),sourceMode=ref('auto'),selectedId=ref(''),layouts=ref([]),fonts=ref([]),error=ref(''),editing=ref(false),editText=ref(''),duration=ref(0),seekTime=ref(0),exportFormat=ref('jpeg'),thumbnails=ref({}),painting=ref(false);
let alive=true,revision=0,thumbnailRevision=0,formatRevision=0,backgroundKey='',backgroundImage=null,backgroundJob=null,drag=null,thumbTimer,viewportObserver,viewportSize;
const fontJobs=new Map();
const openedCover=ref('');
const exporting=ref(false);
const recoveringFonts=ref(false),fontRecoveryMessage=ref('');
let fontRecoveryRevision=0;
const systemTemplateMode=ref(false),templateApplying=ref(false),templateMessage=ref(''),fontsLoading=ref(false);
let templateRequest=0,fontCatalogVersion=0,fontCatalogRequest=0;
const scene=computed(()=>coverScene(d.value.cover));
const selected=computed(()=>scene.value.layers.find(layer=>layer.id===selectedId.value));
const selectedLayout=computed(()=>layouts.value.find(layer=>layer.id===selectedId.value));
const sourceVideo=computed(()=>d.value.edit.resultId||d.value.edit.sourceId||d.value.video.assetId);
const sourceAsset=computed(()=>state.value.assets.find(a=>a.id===sourceVideo.value));
const defaultTemplate=computed(()=>state.value.settings.coverDefaultTemplate||'default');
const sceneId=computed(()=>templateId(d.value.cover.template));
const formatId=computed(()=>coverFormats.find(item=>item.width===scene.value.width&&item.height===scene.value.height)?.id||'portrait');
const canvasStyle=computed(()=>{const ratio=scene.value.width/scene.value.height,minHeight=ratio<1?360:ratio>1?180:240;return {'--cover-aspect':ratio,'--cover-min-width':minHeight*ratio+'px','--cover-min-height':minHeight+'px'};});
const overlayStyle=computed(()=>{const layout=selectedLayout.value;if(!layout)return {};return {left:(layout.style.x+layout.left)/scene.value.width*100+'%',top:(layout.style.y-layout.height/2)/scene.value.height*100+'%',width:layout.width/scene.value.width*100+'%',height:Math.max(5,layout.height/scene.value.height*100)+'%',transform:`rotate(${layout.style.rotation}deg)`,transformOrigin:`${-layout.left/layout.width*100}% 50%`};});
function commit(next){d.value.cover.scene=next;d.value.cover.modelVersion=1;d.value.cover.template=next.templateId;}
function editStyle(style){const next=scene.value;next.layers.find(l=>l.id===selectedId.value).style=style;commit(next);}
function editMask(mask){commit({...scene.value,mask});}
function layerText(text){const next=scene.value,layer=next.layers.find(l=>l.id===selectedId.value);if(!layer)return;layer.text=text;layer.binding='';if(layer.id==='main')d.value.cover.title=text;else if(layer.id==='sub')d.value.cover.subtitle=text;commit(next);}
async function chooseTemplate(id){
  if(!alive||busy.value||exporting.value||recoveringFonts.value||fontsLoading.value||drag)return;
  finishInline();
  const seq=++templateRequest,taskId=d.value.id,signature=coverSignature(d.value.cover),mode=systemTemplateMode.value,fontVersion=fontCatalogVersion,input=templateScene(id,d.value.cover.title,d.value.cover.subtitle,scene.value);
  templateMessage.value='';
  if(!mode){selectedId.value='';templateApplying.value=false;commit(input);error.value='';return;}
  const current=()=>alive&&seq===templateRequest&&taskId===d.value.id&&signature===coverSignature(d.value.cover)&&mode===systemTemplateMode.value&&fontVersion===fontCatalogVersion&&!busy.value&&!exporting.value&&!recoveringFonts.value&&!fontsLoading.value&&!editing.value&&!drag;
  templateApplying.value=true;
  try{
    const result=await recoverMissingCoverFonts(input,fonts.value,{loadFont,hasLocalFont});
    await withFonts(result.scene);
    if(!current())return;
    selectedId.value='';commit({...result.scene,fontVariant:'system'});templateMessage.value='已选用系统字体版，仅替换缺失字体或清理失效引用。文字、配色和版式沿用此模板，请核对字形与换行。';error.value='';
  }catch(e){if(current())templateMessage.value='系统字体模板未能准备，当前封面保持不变：'+e.message;}
  finally{if(seq===templateRequest)templateApplying.value=false;}
}
function changeFormat(id){formatRevision++;const format=coverFormats.find(item=>item.id===id);if(!format||format.id===formatId.value)return;finishInline();commit(resizeCoverScene(scene.value,format));selectedId.value='';nextTick(resizeCanvasViewport);}
async function matchVideoFormat(){if(!sourceVideo.value)return;try{const taskId=d.value.id,source=sourceVideo.value,seq=++formatRevision,signature=coverSignature(d.value.cover),size=await call('coverSourceSize',{assetId:source});if(seq!==formatRevision||taskId!==d.value.id||source!==sourceVideo.value||signature!==coverSignature(d.value.cover))return;const format=formatForVideo(size.width,size.height);if(!format){notify('当前视频比例暂不支持自动匹配，请手动选择封面画幅');return;}changeFormat(format.id);}catch(e){notify(e.message,'error');}}
async function setDefault(id){try{const result=await call('saveCoverDefault',{templateId:id});state.value.settings.coverDefaultTemplate=result.templateId;notify('已设为默认封面模板','success');}catch(e){notify(e.message,'error');}}
function addText(){finishInline();const next=scene.value,id=crypto.randomUUID();next.layers.push({id,text:'新增文本',binding:'',style:textStyle({x:next.width/2,y:next.height*.55,boxWidth:next.width*.9})});commit(next);selectedId.value=id;tab.value='layers';revealSelectedLayer();}
function resizeCanvasViewport(){
  const node=canvasViewport.value;if(!node)return;
  // 调整窗口时保留查看中心；首次显示时居中，鼠标拖动期间不改变视口。
  const fractionY=viewportSize?(node.scrollTop+viewportSize.height/2)/Math.max(1,viewportSize.scrollHeight):.5;
  const fractionX=viewportSize?(node.scrollLeft+viewportSize.width/2)/Math.max(1,viewportSize.scrollWidth):.5;
  if(!drag){node.scrollTop=Math.max(0,fractionY*node.scrollHeight-node.clientHeight/2);node.scrollLeft=Math.max(0,fractionX*node.scrollWidth-node.clientWidth/2);}
  viewportSize={height:node.clientHeight,width:node.clientWidth,scrollHeight:node.scrollHeight,scrollWidth:node.scrollWidth};
}
async function revealSelectedLayer(){
  await nextTick();const node=canvasViewport.value,layer=selected.value;if(!node||!stack.value||!layer||drag)return;
  const viewport=node.getBoundingClientRect(),content=stack.value.getBoundingClientRect();
  node.scrollTop+=content.top-viewport.top+layer.style.y/scene.value.height*content.height-node.clientHeight/2;
  node.scrollLeft+=content.left-viewport.left+layer.style.x/scene.value.width*content.width-node.clientWidth/2;
}
function selectLayer(id){selectedId.value=id;revealSelectedLayer();}
function removeLayer(){if(!selected.value)return;const next=scene.value;next.layers=next.layers.filter(l=>l.id!==selectedId.value);commit(next);selectedId.value='';editing.value=false;}
function reorder(direction){const next=scene.value,index=next.layers.findIndex(l=>l.id===selectedId.value),target=index+direction;if(target<0||target>=next.layers.length)return;[next.layers[index],next.layers[target]]=[next.layers[target],next.layers[index]];commit(next);}
async function loadFont(font){
  if(!font)return '';if(fontJobs.has(font.id))return fontJobs.get(font.id);
  const job=(async()=>{const result=await call('coverFontData',{fontId:font.id}),bytes=Uint8Array.from(atob(result.data),ch=>ch.charCodeAt(0));const alias='cover_'+font.id.replace(/-/g,'_'),face=await new FontFace(alias,bytes.buffer).load();document.fonts.add(face);return alias;})();fontJobs.set(font.id,job);try{return await job;}catch(e){fontJobs.delete(font.id);throw new Error('封面字体加载失败：'+font.label+'，请重新选择字体。'+e.message);}
}
function withFonts(input){return prepareCoverFonts(input,fonts.value,loadFont);}
async function hasLocalFont(family){
  // FontFace的local来源实际查找本机字体，避免document.fonts.check以回退字形冒认字体已存在。
  try{await new FontFace('cover_local_probe','local('+JSON.stringify(family)+')').load();return true;}catch{return false;}
}
async function recoverCurrentFonts(){
  if(!alive||busy.value||exporting.value||recoveringFonts.value||editing.value||fontsLoading.value)return;
  const id=d.value.id,signature=coverSignature(d.value.cover),seq=++fontRecoveryRevision,input=scene.value,fontVersion=fontCatalogVersion;
  const current=()=>alive&&seq===fontRecoveryRevision&&id===d.value.id&&signature===coverSignature(d.value.cover)&&fontVersion===fontCatalogVersion&&!busy.value&&!exporting.value&&!editing.value&&!fontsLoading.value;
  recoveringFonts.value=true;fontRecoveryMessage.value='';
  try{
    const result=await recoverMissingCoverFonts(input,fonts.value,{loadFont,hasLocalFont});
    if(!current())return;
    if(!result.replaced.length&&!result.repaired.length){fontRecoveryMessage.value='未确认当前封面存在缺失字体，封面未修改。请核对上方错误，或重新配置字体目录后载入。';return;}
    // 原字体准备流程也通过后才一次提交，避免清理引用成功但真实绘制仍被目录契约拒绝。
    await withFonts(result.scene);
    if(!current())return;
    commit(result.scene);fontRecoveryMessage.value=(result.replaced.length?'已将当前封面中 '+result.replaced.length+' 个缺失字体图层改用本机'+result.family+'。':'')+(result.repaired.length?'已清理 '+result.repaired.length+' 个失效字体文件引用，保留本机可用的原字体。':'')+'其他图层、文字和样式保留；原模板未修改，请检查文字换行与预览。';
    await paint();
  }catch(e){if(current())fontRecoveryMessage.value=e.message;}
  finally{if(seq===fontRecoveryRevision)recoveringFonts.value=false;}
}
async function loadBackground(id){if(backgroundKey===id&&backgroundJob)return backgroundJob;backgroundKey=id;backgroundJob=(async()=>{if(!id)return null;const data=await call('imageData',{id}),image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('无法读取封面背景，请重新选择图片'));image.src=data;});return image;})();return backgroundJob;}
async function paint(){
  const seq=++revision,taskId=d.value.id,cover=JSON.parse(JSON.stringify(d.value.cover));painting.value=true;
  try{await nextTick();const [prepared,image]=await Promise.all([withFonts(coverScene(cover)),loadBackground(cover.backgroundId)]);if(!alive||seq!==revision||taskId!==d.value.id||!canvas.value)return;backgroundImage=image;layouts.value=drawCover(canvas.value,prepared,image,Number(cover.blur)||0);error.value='';}
  catch(e){if(alive&&seq===revision&&taskId===d.value.id)error.value=e.message;}finally{if(alive&&seq===revision&&taskId===d.value.id){painting.value=false;scheduleThumbnails();}}
}
function scheduleThumbnails(){
 clearTimeout(thumbTimer);const generation=++thumbnailRevision,seq=revision,id=d.value.id,cover=JSON.parse(JSON.stringify(d.value.cover)),size={width:scene.value.width,height:scene.value.height},mode=systemTemplateMode.value,fontVersion=fontCatalogVersion;
 const isCurrent=()=>alive&&seq===revision&&generation===thumbnailRevision&&id===d.value.id&&mode===systemTemplateMode.value&&fontVersion===fontCatalogVersion&&!fontsLoading.value;
 thumbnails.value=loadingThumbnails(coverTemplates);
 thumbTimer=setTimeout(()=>renderThumbnails({items:coverTemplates,isCurrent,publish:result=>{thumbnails.value=result;},render:async item=>{const input=templateScene(item.id,cover.title,cover.subtitle,size),candidate=mode?(await recoverMissingCoverFonts(input,fonts.value,{loadFont,hasLocalFont})).scene:input;const [prepared,image]=await Promise.all([withFonts(candidate),loadBackground(cover.backgroundId)]);const c=document.createElement('canvas');c.width=216;c.height=Math.round(216*size.height/size.width);drawCover(c,prepared,image,Number(cover.blur)||0);return c.toDataURL('image/jpeg',.8);}}),180);
}
function invalidateTemplateWork(){templateRequest++;templateApplying.value=false;templateMessage.value='';thumbnailRevision++;clearTimeout(thumbTimer);}
async function retryThumbnails(){
  const request=++fontCatalogRequest,directory=state.value.settings.subtitleFontsDir||'';fontCatalogVersion++;invalidateTemplateWork();fontJobs.clear();fontsLoading.value=true;
  try{const available=await call('listSubtitleFonts');if(!alive||request!==fontCatalogRequest||directory!==(state.value.settings.subtitleFontsDir||''))return;fonts.value=available;backgroundJob=null;}
  catch(e){if(alive&&request===fontCatalogRequest){fonts.value=[];error.value=e.message;}}
  finally{if(alive&&request===fontCatalogRequest){fontsLoading.value=false;await paint();}}
}
async function frame(time){if(!sourceVideo.value){notify('请先选择视频源');return;}const taskId=d.value.id,source=sourceVideo.value;const result=await act('截取视频封面',()=>call('frame',{id:taskId,assetId:source,time}));if(result&&d.value.id===taskId&&sourceVideo.value===source){d.value.cover.backgroundId=result.id;d.value.cover.frameTime=time;notify('已使用当前帧作为封面','success');}}
function randomFrame(){return frame(Math.random()*Math.min(5,Number(sourceAsset.value?.duration)||duration.value||5));}
function loadedVideo(){duration.value=Number.isFinite(video.value?.duration)?video.value.duration:0;seekTime.value=Math.min(d.value.cover.frameTime||0,Math.max(0,duration.value-.05));seek();}
function seek(){if(video.value&&duration.value)video.value.currentTime=Math.min(seekTime.value,Math.max(0,duration.value-.05));}
async function generateTitle(){const id=d.value.id,text=downstreamText(d.value),signature=coverSignature(d.value.cover);if(!text.trim()){notify('请先填写用于生成标题的文案');return;}const result=await act('生成封面标题',()=>call('text',{id,kind:'title'}));if(result){if(result.quality?.status==='rejected'){notify('标题未通过内容检查：'+result.quality.issues.join('；')+'；完整结果已保存在执行记录','error');return;}if(result.stale||id!==d.value.id||text!==downstreamText(d.value)||signature!==coverSignature(d.value.cover)){notify('文案或封面已变化，本次标题未覆盖当前内容');return;}d.value.cover.title=result.text;await chooseTemplate(sceneId.value);if(id===d.value.id&&d.value.cover.title===result.text&&sourceVideo.value&&!d.value.cover.backgroundId)await randomFrame();}}
async function exportCover(){
  finishInline();const id=d.value.id;let acceptedSignature='';
  const result=await act('生成封面',async()=>{const cover=JSON.parse(JSON.stringify(d.value.cover)),signature=coverSignature(cover);acceptedSignature=signature;const [prepared,image]=await Promise.all([withFonts(validScene(coverScene(cover))),loadBackground(cover.backgroundId)]);if(d.value.id!==id||coverSignature(d.value.cover)!==signature)throw new Error('封面内容已变化，请重新生成');const output=document.createElement('canvas');output.width=prepared.width;output.height=prepared.height;drawCover(output,prepared,image,Number(cover.blur)||0);return call('saveCover',{id,base64:output.toDataURL('image/'+exportFormat.value,.95),signature});});
  if(result&&d.value.id===id&&coverSignature(d.value.cover)===acceptedSignature){d.value.cover.assetId=result.id;notify(scene.value.width+' × '+scene.value.height+' '+(exportFormat.value==='jpeg'?'JPG':'PNG')+'封面已生成','success');return result;}return undefined;
}
async function saveToFile(asset){try{if(window.studio){const result=await window.studio.exportAsset(asset.id);if(!result.canceled)notify('已导出 '+result.name,'success');}else{const link=document.createElement('a');link.href=mediaUrl(asset.id);link.download=asset.name;link.click();}}catch(e){notify('导出失败：'+e.message,'error');}}
async function exportImage(){if(exporting.value||busy.value)return;exporting.value=true;try{const asset=await exportCover();if(asset)await saveToFile(asset);}finally{exporting.value=false;}}
defineExpose({generate:exportCover,generateTitle});
async function exportVideo(){if(exporting.value||busy.value)return;exporting.value=true;try{const cover=await exportCover();if(!cover)return;const id=d.value.id,source=sourceVideo.value,signature=coverSignature(d.value.cover);const result=await act('合成封面视频',()=>call('coverVideo',{id}));if(result&&id===d.value.id&&source===sourceVideo.value&&signature===coverSignature(d.value.cover)){d.value.cover.videoId=result.id;d.value.publish.videoId=result.id;notify('已生成首帧封面视频，视频时长保持不变','success');await saveToFile(result);}}finally{exporting.value=false;}}
function openCover(){if(d.value.cover.assetId)openedCover.value=d.value.cover.assetId;}
function point(event){const r=canvas.value.getBoundingClientRect();return {x:(event.clientX-r.left)/r.width*scene.value.width,y:(event.clientY-r.top)/r.height*scene.value.height};}
function pointerDown(event){
  if(busy.value||editing.value||painting.value||event.button!==0)return;const p=point(event),layout=selectedLayout.value,tolerance=10*scene.value.width/canvas.value.getBoundingClientRect().width;
  if(layout){const q=localPoint(p,layout.style),right=layout.left+layout.width;if(Math.hypot(q.x-right,q.y-layout.height/2)<tolerance)drag={kind:'scale',id:layout.id,start:p,style:{...layout.style},distance:Math.hypot(p.x-layout.style.x,p.y-layout.style.y)};else if(Math.hypot(q.x-(layout.left+layout.width/2),q.y+layout.height/2+160)<tolerance)drag={kind:'rotate',id:layout.id,style:{...layout.style}};}
  if(!drag){const hit=[...layouts.value].reverse().find(l=>hitLayer(p,l));selectedId.value=hit?.id||'';if(hit)drag={kind:'move',id:hit.id,start:p,style:{...hit.style}};}
  if(drag)canvas.value.setPointerCapture(event.pointerId);stack.value?.focus({preventScroll:true});
}
function pointerMove(event){if(!drag)return;const p=point(event),next=scene.value,layer=next.layers.find(l=>l.id===drag.id);if(!layer){drag=null;return;}const initial=drag.style;if(drag.kind==='move'){layer.style.x=Math.round(initial.x+p.x-drag.start.x);layer.style.y=Math.round(initial.y+p.y-drag.start.y);}else if(drag.kind==='rotate'){layer.style.rotation=Math.round(Math.atan2(p.y-initial.y,p.x-initial.x)*180/Math.PI+90);}else{const ratio=Math.max(.1,Math.hypot(p.x-initial.x,p.y-initial.y)/Math.max(1,drag.distance));layer.style.fontSize=Math.max(8,Math.min(600,Math.round(initial.fontSize*ratio)));layer.style.boxWidth=Math.max(20,Math.min(2000,Math.round(initial.boxWidth*ratio)));}delete layer.style.renderFamily;commit(next);}
function pointerUp(){drag=null;}
async function beginInline(){if(!selected.value||busy.value)return;editText.value=selected.value.text;editing.value=true;await nextTick();inlineEditor.value?.focus();inlineEditor.value?.select();}
function finishInline(){if(!editing.value)return;editing.value=false;layerText(editText.value);}
function cancelInline(){editing.value=false;}
function keyboard(event){if(event.target!==stack.value||busy.value)return;if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();removeLayer();}else if(event.key==='Enter'){event.preventDefault();beginInline();}else if(event.key==='Escape'){selectedId.value='';}else if(selected.value&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();const s={...selected.value.style},step=event.shiftKey?10:1;s.x+=(event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0);s.y+=(event.key==='ArrowDown'?step:event.key==='ArrowUp'?-step:0);editStyle(s);}}
watch(()=>JSON.stringify(d.value.cover),paint);
watch(()=>d.value.id,()=>{selectedId.value='';editing.value=false;drag=null;thumbnails.value={};duration.value=0;seekTime.value=0;paint();});
watch(()=>d.value.id,()=>{fontRecoveryRevision++;recoveringFonts.value=false;fontRecoveryMessage.value='';},{flush:'sync'});
watch(()=>d.value.id,invalidateTemplateWork,{flush:'sync'});
watch(systemTemplateMode,()=>{invalidateTemplateWork();scheduleThumbnails();},{flush:'sync'});
watch(()=>JSON.stringify(fonts.value),()=>{fontCatalogVersion++;fontJobs.clear();invalidateTemplateWork();scheduleThumbnails();},{flush:'sync'});
watch(()=>state.value.settings.subtitleFontsDir,()=>{retryThumbnails();},{flush:'sync'});
watch(sourceVideo,()=>{duration.value=0;seekTime.value=0;});
onMounted(async()=>{await retryThumbnails();if(alive&&canvasViewport.value){viewportObserver=new ResizeObserver(resizeCanvasViewport);viewportObserver.observe(canvasViewport.value);}});
onUnmounted(()=>{alive=false;revision++;fontRecoveryRevision++;fontCatalogRequest++;invalidateTemplateWork();clearTimeout(thumbTimer);viewportObserver?.disconnect();});
</script>
<template><div class="cover-editor cover-editor-full" :style="canvasStyle">
  <div class="source-bar"><div class="cover-source-label"><h3>封面设计</h3><small>{{sourceAsset?'视频源：'+sourceAsset.name:'未检测到视频源'}}</small><button @click="emit('choose','video',a=>d.edit.sourceId=a.id,'选择封面视频源')">修改</button></div><div class="cover-source-actions"><button :disabled="!!busy" @click="generateTitle"><I name="FileText" :size="14"/>一键生成</button><button :disabled="!d.cover.assetId" @click="openCover">打开封面</button><button :disabled="!!busy||exporting||!!error" @click="exportImage"><I name="ExternalLink" :size="14"/>{{d.cover.assetId?'导出封面':'生成并导出封面'}}</button><button class="primary" :disabled="!!busy||exporting||!sourceVideo||!!error" @click="exportVideo"><I name="Video" :size="14"/>{{d.cover.assetId?'导出封面视频':'生成并导出封面视频'}}</button></div></div>
  <div v-if="error" class="cover-error" role="alert">{{error}}</div>
  <section v-if="error||fontRecoveryMessage" class="cover-font-recovery" aria-label="封面字体恢复"><div><p v-if="error">若当前封面字体已缺失，可明确改用本机系统字体。仅替换不可用的字体，文字和其他样式保留；替换后字形与换行可能变化。</p><p v-if="fontRecoveryMessage" role="status">{{fontRecoveryMessage}}</p></div><button v-if="error" :disabled="!!busy||exporting||recoveringFonts||editing" @click="recoverCurrentFonts">{{recoveringFonts?'正在检查本机字体…':'改用本机系统字体'}}</button></section>
  <div class="cover-layout">
    <section class="cover-preview"><div class="card-heading"><strong>封面预览</strong><small>{{scene.width}} × {{scene.height}}</small></div><div class="cover-format-bar"><label>画幅<select aria-label="封面画幅" :value="formatId" :disabled="!!busy" @change="changeFormat($event.target.value)"><option v-for="format in coverFormats" :key="format.id" :value="format.id">{{format.label}}</option></select></label><button :disabled="!!busy||!sourceVideo" @click="matchVideoFormat">匹配视频画幅</button></div><div ref="canvasViewport" class="canvas-holder" tabindex="0" aria-label="封面画布滚动区"><div ref="stack" class="cover-canvas-stack" :class="{'cover-canvas-wide':scene.width>=scene.height}" tabindex="0" aria-label="封面画布操作区" @keydown="keyboard"><canvas ref="canvas" :width="scene.width" :height="scene.height" aria-label="封面编辑画布" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp" @lostpointercapture="pointerUp" @dblclick="beginInline"></canvas>
      <svg v-if="selectedLayout&&!editing" class="cover-selection" :viewBox="`0 0 ${scene.width} ${scene.height}`" aria-hidden="true"><g :transform="`translate(${selectedLayout.style.x} ${selectedLayout.style.y}) rotate(${selectedLayout.style.rotation})`"><rect :x="selectedLayout.left" :y="-selectedLayout.height/2" :width="selectedLayout.width" :height="selectedLayout.height"/><line :x1="selectedLayout.left+selectedLayout.width/2" :x2="selectedLayout.left+selectedLayout.width/2" :y1="-selectedLayout.height/2" :y2="-selectedLayout.height/2-160"/><rect :x="selectedLayout.left-14" :y="-selectedLayout.height/2-14" width="28" height="28"/><rect :x="selectedLayout.left+selectedLayout.width-14" :y="selectedLayout.height/2-14" width="28" height="28"/><circle :cx="selectedLayout.left+selectedLayout.width/2" :cy="-selectedLayout.height/2-160" r="18"/></g></svg>
      <textarea v-if="editing" ref="inlineEditor" v-model="editText" class="cover-inline-editor" :style="overlayStyle" aria-label="画布文字编辑" @blur="finishInline" @keydown.esc.stop="cancelInline" @keydown.ctrl.enter.prevent="finishInline"></textarea><span v-if="painting" class="cover-painting">正在更新预览…</span>
    </div></div><p class="hint">点击文字可选中，拖动调整，双击文字直接修改</p><div class="toolbar"><button class="danger" :disabled="!selected||!!busy" @click="removeLayer"><I name="Trash2" :size="14"/>删除选中图层</button><button :disabled="!!busy" @click="addText"><I name="Plus" :size="15"/>添加文本</button></div></section>
    <section class="cover-options"><div class="segmented" role="tablist" aria-label="封面选项"><button v-for="[id,name] in [['templates','模板'],['source','封面来源'],['layers','文本图层'],['mask','遮罩']]" :key="id" role="tab" :aria-selected="tab===id" :class="{active:tab===id}" @click="finishInline();tab=id">{{name}}</button></div><div class="cover-option-body" :inert="!!busy">
      <div v-if="tab==='templates'" class="cover-templates"><section class="cover-template-mode" aria-label="模板字体模式"><label><input v-model="systemTemplateMode" type="checkbox" :disabled="!!busy||exporting||recoveringFonts"/>系统字体模板</label><p>开启后预览与之后点选的模板使用系统字体版，仅替换缺失字体；字形与换行可能变化。开关不会修改当前封面或默认设置。</p><p v-if="scene.fontVariant==='system'">当前封面已选用：系统字体版。</p><p v-if="templateApplying" role="status">正在准备所选系统字体模板…</p><p v-if="templateMessage" role="status">{{templateMessage}}</p></section><div class="cover-template-feedback"><span>{{systemTemplateMode?'当前预览：系统字体版；明确点选后才替换当前封面。':'原字体预览；失败仍可选择模板，在文本图层中修改字体。'}}</span><button :disabled="!!busy||fontsLoading" @click="retryThumbnails">{{fontsLoading?'正在读取字体…':'重新载入预览'}}</button></div><article v-for="item in coverTemplates" :key="item.id" class="cover-template-item" :class="{active:sceneId===item.id}" :data-preview-status="thumbnails[item.id]?.status||'loading'"><button class="cover-template-select" :aria-label="item.name+(systemTemplateMode?' · 系统字体版':'')" :aria-pressed="sceneId===item.id" :title="item.description" @click="chooseTemplate(item.id)"><img v-if="thumbnails[item.id]?.status==='ready'" :src="thumbnails[item.id].url" :alt="item.name+'预览'"/><div v-else class="cover-template-placeholder" role="status">{{thumbnails[item.id]?.status==='failed'?'预览失败':'正在载入…'}}</div><span>{{item.name}}<small v-if="systemTemplateMode"> · 系统字体版</small></span><I v-if="sceneId===item.id" class="cover-template-check" name="CheckCircle2" :size="21"/></button><details v-if="thumbnails[item.id]?.status==='failed'" class="cover-template-error"><summary>查看失败原因</summary><p>{{thumbnails[item.id].error}}</p></details><button class="cover-default-star" :class="{active:defaultTemplate===item.id}" :aria-label="'将'+item.name+'设为默认'" :aria-pressed="defaultTemplate===item.id" @click="setDefault(item.id)"><I name="Star" :size="13"/></button></article></div>
      <div v-else-if="tab==='source'" class="cover-source-options"><div class="cover-source-modes" role="group" aria-label="封面来源方式"><button v-for="[id,label] in [['auto','自动抽帧'],['timeline','时间轴选帧'],['local','本地图片']]" :key="id" :class="{active:sourceMode===id}" :aria-pressed="sourceMode===id" @click="sourceMode=id">{{label}}</button></div><template v-if="sourceMode==='auto'"><p class="hint">从视频前5秒随机抽取一帧作为封面</p><button class="secondary full" :disabled="!sourceVideo" @click="randomFrame"><I name="RefreshCw" :size="15"/>重新随机抽帧</button></template><template v-else-if="sourceMode==='timeline'"><video v-if="sourceVideo" :key="sourceVideo" ref="video" class="cover-frame-video" :src="mediaUrl(sourceVideo)" preload="metadata" muted playsinline @loadedmetadata="loadedVideo"></video><p v-else class="hint">请先选择视频源</p><label class="cover-timeline"><span>选帧时间 <output>{{seekTime.toFixed(2)}}s / {{duration.toFixed(2)}}s</output></span><input v-model.number="seekTime" type="range" aria-label="封面选帧时间轴" min="0" :max="Math.max(0,duration-.05)" step="0.01" :disabled="!duration" @input="seek"/></label><button class="secondary full" :disabled="!duration" @click="frame(seekTime)">使用当前帧</button></template><template v-else><button class="secondary full" @click="emit('choose','image',a=>d.cover.backgroundId=a.id,'选择封面背景')"><I name="ImagePlus" :size="16"/>选择本地图片</button><p class="hint">{{state.assets.find(a=>a.id===d.cover.backgroundId)?.name||'尚未选择背景图片'}}</p></template><button class="text-button" :disabled="!d.cover.backgroundId" @click="d.cover.backgroundId=''">清除背景图片</button><CoverRange label="背景模糊" :model-value="Number(d.cover.blur)||0" :max="30" @update:model-value="d.cover.blur=$event"/></div>
      <div v-else-if="tab==='layers'" class="cover-layer-options"><div class="cover-layer-heading"><strong>{{selected?'已选中：'+selected.text:'请点击画布中的文字选择图层'}}</strong><button @click="addText">添加文本</button><button class="danger" :disabled="!selected" @click="removeLayer"><I name="Trash2" :size="14"/>删除</button></div><div v-if="selected" class="cover-layer-content"><CoverTextProperties :model-value="selected.style" :fonts="fonts" :bounds="selectedLayout" :width="scene.width" :height="scene.height" @update:model-value="editStyle"/></div><div class="cover-layer-list" aria-label="封面图层列表"><button v-for="(layer,index) in scene.layers" :key="layer.id" :class="{active:selectedId===layer.id}" :aria-label="'选择文字图层'+(index+1)" :aria-pressed="selectedId===layer.id" @click="selectLayer(layer.id)"><I name="Type" :size="14"/><span>{{layer.text||'空文本'}}</span></button></div><div v-if="selected" class="cover-layer-order"><button :disabled="scene.layers.at(-1)?.id===selectedId" @click="reorder(1)">上移一层</button><button :disabled="scene.layers[0]?.id===selectedId" @click="reorder(-1)">下移一层</button></div></div>
      <CoverMaskProperties v-else :width="scene.width" :height="scene.height" :model-value="scene.mask" @update:model-value="editMask"/>
    </div><div class="cover-bottom"><select v-model="exportFormat" aria-label="封面图片格式"><option value="jpeg">JPG</option><option value="png">PNG</option></select><button :disabled="!!busy||!!error" @click="exportCover"><I name="Check" :size="16"/>生成封面</button></div></section>
  </div>
</div><Modal v-if="openedCover" title="已生成封面预览" wide @close="openedCover=''"><img class="cover-export-preview" :src="mediaUrl(openedCover)" alt="已生成的真实封面图片"/><template #footer><button @click="openedCover=''">关闭</button></template></Modal></template>
<style scoped>
.cover-template-mode{grid-column:1/-1;display:grid;gap:8px;padding:12px;border:1px solid var(--border,#e6e8ee);border-radius:8px;font-size:var(--app-font-size-micro);line-height:1.6}.cover-template-mode label{display:flex;align-items:center;gap:8px;font-weight:600}.cover-template-mode input[type="checkbox"]{appearance:auto;display:inline-block;position:static;width:16px;min-width:16px;max-width:16px;height:16px;min-height:16px;max-height:16px;flex:0 0 16px;margin:0;padding:0;opacity:1;accent-color:var(--primary,#3b82f6);cursor:pointer}.cover-template-mode input[type="checkbox"]:focus-visible{outline:2px solid var(--primary,#3b82f6);outline-offset:3px}.cover-template-mode input[type="checkbox"]:disabled{cursor:not-allowed}.cover-template-mode p{margin:0;overflow-wrap:anywhere}
.cover-template-mode input[type="checkbox"]::after{display:none}
.cover-font-recovery{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:12px 16px;border:1px solid var(--border,#e6e8ee);border-radius:8px;font-size:var(--app-font-size-micro);line-height:1.6}
.cover-font-recovery>div{flex:1 1 280px;min-width:0}.cover-font-recovery p{margin:0;overflow-wrap:anywhere}.cover-font-recovery button{white-space:normal;flex:0 1 auto}
.cover-template-feedback{grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:var(--app-font-size-micro);color:var(--text-muted,#abb2c3)}
.cover-template-feedback button{margin-left:auto;white-space:nowrap}
.cover-template-error{margin-top:8px;font-size:var(--app-font-size-micro);line-height:1.5;overflow-wrap:anywhere;color:var(--text-primary,#f1f3f8)}
.cover-template-error summary{cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.cover-template-error p{margin:6px 0 0;white-space:normal}
</style>
