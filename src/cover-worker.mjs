import {call} from './api.js';
import {coverScene,validScene} from './cover-model.mjs';
import {drawCover} from './cover-render.mjs';
import {prepareCoverFonts} from './cover-fonts.mjs';
import {prepareTitle,drawTitle,loadTitleFont,titleSnapshot} from './title-render.mjs';
import {createCustomTitleNode} from './title-custom-preview.mjs';
import {namecardSnapshot} from '../server/namecard-model.mjs';
import {prepareNamecard,drawNamecard} from './namecard-render.mjs';

const jobs=new Map();
async function font(font){if(jobs.has(font.id))return jobs.get(font.id);const job=(async()=>{const data=await call('coverFontData',{fontId:font.id}),alias='cover_'+font.id.replace(/-/g,'_'),bytes=Uint8Array.from(atob(data.data),ch=>ch.charCodeAt(0)),face=await new FontFace(alias,bytes.buffer).load();document.fonts.add(face);return alias;})();jobs.set(font.id,job);return job;}
// 隐藏绘制窗口只接收快照；页面导航或关闭编辑器不影响后台封面。
window.renderCover=async cover=>{
 const scene=validScene(coverScene(cover)),fonts=await call('listSubtitleFonts'),prepared=await prepareCoverFonts(scene,fonts,font);let image=null;
 if(cover.backgroundId){const url=await call('imageData',{id:cover.backgroundId});image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('后台封面背景无法解码'));image.src=url;});}
 const canvas=document.createElement('canvas');canvas.width=scene.width;canvas.height=scene.height;drawCover(canvas,prepared,image,Number(cover.blur)||0);return canvas.toDataURL('image/jpeg',.95);
};
window.renderTitle=async input=>{
 const snapshot=titleSnapshot({title:input.main,subtitle:input.sub,titleDesign:input.design},input.width,input.height),fonts=await call('listSubtitleFonts'),prepared=await prepareTitle(snapshot,fonts,f=>loadTitleFont(call,f)),canvas=document.createElement('canvas');
 if(snapshot.design.mode==='custom'){
  document.documentElement.style.cssText='margin:0;background:transparent;overflow:hidden';document.body.style.cssText='margin:0;background:transparent;overflow:hidden';
  const {node,layout}=createCustomTitleNode(prepared,{preview:false});document.body.replaceChildren(node);await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const r=node.getBoundingClientRect();return {capture:true,viewport:{viewportWidth:innerWidth,viewportHeight:innerHeight,deviceScaleFactor:devicePixelRatio},bounds:{x:r.x,y:r.y,width:r.width,height:r.height,coordinateSystem:'native-video',rows:layout.lines.length,layout:{kind:layout.kind,nativeScale:layout.nativeScale,effectScale:layout.effectScale,fontSize:layout.fontSize,topPercent:layout.topPercent,gap:layout.gap}}};
 }
 canvas.width=snapshot.width;canvas.height=snapshot.height;const bounds=drawTitle(canvas,prepared);return {data:canvas.toDataURL('image/png'),bounds};
};
window.renderNamecard=async input=>{
 const snapshot=namecardSnapshot({cardName:input.name,cardDescription:input.lines.join('\n'),cardDesign:input.design},input.width,input.height),fonts=await call('listSubtitleFonts'),prepared=await prepareNamecard(snapshot,fonts,f=>loadTitleFont(call,f)),canvas=document.createElement('canvas');
 const bounds=drawNamecard(canvas,prepared);return {data:canvas.toDataURL('image/png'),bounds};
};
