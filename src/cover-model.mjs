import templates from '../server/cover-templates.json' with {type:'json'};
import {coverSize} from '../server/cover-size.mjs';
export {coverFormats,formatForVideo} from '../server/cover-size.mjs';
export const coverTemplates=templates;
export const textDefaults={fontFamily:'Microsoft YaHei',fontId:'',fontSize:90,bold:false,italic:false,underline:false,color:'#FFFFFF',opacity:1,letterSpacing:0,lineHeight:1.3,align:'center',x:540,y:960,rotation:0,boxWidth:972,stroke:{enabled:false,color:'#000000',width:4},background:{enabled:false,color:'#000000',opacity:.6,radius:0,width:null,height:null},shadow:{enabled:false,color:'#000000',opacity:.5,blur:10,distance:4}};
export const maskDefaults={enabled:false,x:0,y:760,width:1080,height:400,color:'#000000',opacity:.6,radius:0,gradient:false,gradientStartColor:'#000000',gradientStartOpacity:0,gradientColor:'#000000',gradientOpacity:1,gradientAngle:90,stroke:{enabled:false,color:'#FFFFFF',width:4}};
export function textStyle(input={}){return {...structuredClone(textDefaults),...input,stroke:{...textDefaults.stroke,...input.stroke},background:{...textDefaults.background,...input.background},shadow:{...textDefaults.shadow,...input.shadow}};}
export function templateId(id){return id==='V0'?'default':String(id||'default').toLowerCase();}
export function splitTitle(title,subtitle){const text=String(title||'输入标题');if(subtitle)return {title:text,titleMain:text,titleSub:subtitle};const rows=text.split(/\n|[？?！!，,：:]/u).filter(Boolean);return {title:text,titleMain:rows[0]||text,titleSub:rows.length>1?rows.slice(1).join('，'):'这是一个副标题'};}
export function templateScene(id,title='',subtitle='',size){
  const template=coverTemplates.find(t=>t.id===templateId(id))||coverTemplates[0],parts=splitTitle(title,subtitle);
  const scene={version:1,width:1080,height:1920,templateId:template.id,mask:{...structuredClone(maskDefaults),...structuredClone(template.mask),stroke:{...maskDefaults.stroke,...template.mask.stroke}},shapes:structuredClone(template.shapes||[]),layers:template.textLayers.map(layer=>({id:layer.id,text:layer.text.replace(/\{(title|titleMain|titleSub)\}/g,(_,key)=>parts[key]),binding:/^\{.+\}$/.test(layer.text)?layer.text.slice(1,-1):'',style:textStyle(layer.style)}))};
  return size?resizeCoverScene(scene,size):scene;
}
export function resizeCoverScene(input,size){
  const current=coverSize(input),target=coverSize(size),scene=structuredClone(input),sx=target.width/current.width,sy=target.height/current.height,scale=Math.min(target.width,target.height)/Math.min(current.width,current.height);
  const geometry=item=>{for(const key of ['x','width'])if(Number.isFinite(item[key]))item[key]*=sx;for(const key of ['y','height'])if(Number.isFinite(item[key]))item[key]*=sy;for(const key of ['fillLinearGradientStartPoint','fillLinearGradientEndPoint'])if(item[key]){item[key].x*=sx;item[key].y*=sy;}if(Number.isFinite(item.radius))item.radius*=scale;if(item.stroke?.width)item.stroke.width*=scale;};
  geometry(scene.mask);for(const shape of scene.shapes||[])geometry(shape);
  // 位置按画幅迁移，文字本身等比缩放，避免改变字符形状。
  for(const layer of scene.layers){const s=layer.style;s.x*=sx;s.y*=sy;s.boxWidth*=sx;s.fontSize*=scale;s.letterSpacing*=scale;geometry(s.background);for(const key of ['blur','distance'])s.shadow[key]*=scale;s.stroke.width*=scale;}
  return {...scene,...target};
}
// 旧数据只读转换，直到用户首次操作才写入新场景。
export function coverScene(cover){
  if(cover.scene?.version===1){const scene=JSON.parse(JSON.stringify(cover.scene)),parts=splitTitle(cover.title,cover.subtitle);scene.layers=scene.layers.map(layer=>({...layer,text:layer.binding?parts[layer.binding]:layer.text,style:textStyle(layer.style)}));return scene;}
  const scene=templateScene(cover.template,cover.title,cover.subtitle);
  if(cover.modelVersion===1)return scene;
  const main=scene.layers.find(l=>l.id==='main');if(main){main.style=textStyle({...main.style,fontFamily:'Microsoft YaHei',fontSize:Number(cover.fontSize)||76,bold:true,color:cover.color||'#FFFFFF',y:(Number(cover.y)||.5)*1920});}
  scene.mask={...structuredClone(maskDefaults),enabled:Number(cover.mask)>0,x:0,y:0,width:1080,height:1920,opacity:Number(cover.mask)||0};
  for(const [i,layer]of(cover.layers||[]).entries())scene.layers.push({id:'legacy-'+i,text:layer.text,binding:'',style:textStyle({fontSize:layer.fontSize,color:layer.color,x:layer.x*1080,y:layer.y*1920,bold:true})});
  if(cover.subtitle&&!scene.layers.some(layer=>layer.id==='sub'))scene.layers.push({id:'sub',text:cover.subtitle,binding:'titleSub',style:textStyle({fontSize:(Number(cover.fontSize)||76)*.5,y:(Number(cover.y)||.5)*1920+180})});
  return scene;
}
export const coverSignature=cover=>JSON.stringify({...cover,assetId:undefined,videoId:undefined});
export function localPoint(point,style){const angle=-(Number(style.rotation)||0)*Math.PI/180,dx=point.x-style.x,dy=point.y-style.y;return {x:dx*Math.cos(angle)-dy*Math.sin(angle),y:dx*Math.sin(angle)+dy*Math.cos(angle)};}
export function hitLayer(point,layout,tolerance=0){const p=localPoint(point,layout.style);return p.x>=layout.left-tolerance&&p.x<=layout.left+layout.width+tolerance&&p.y>=-layout.height/2-tolerance&&p.y<=layout.height/2+tolerance;}
export function validScene(scene){
  if(scene?.version!==1||!Array.isArray(scene.layers)||scene.layers.length>100)throw new Error('封面场景数据无效');coverSize(scene);
  for(const layer of scene.layers){const s=layer.style;if(typeof layer.text!=='string'||layer.text.length>5000||!s||!Number.isFinite(s.x)||!Number.isFinite(s.y)||!Number.isFinite(s.fontSize)||s.fontSize<8||s.fontSize>600||!Number.isFinite(s.boxWidth)||s.boxWidth<20||s.boxWidth>3000||!Number.isFinite(s.rotation))throw new Error('文字内容、坐标或字号无效，请检查所选图层');for(const value of [s.opacity,s.background.opacity,s.shadow.opacity])if(!Number.isFinite(value)||value<0||value>1)throw new Error('透明度必须在0到100%之间');}
  return scene;
}
