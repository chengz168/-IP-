const fontAliases={'东方大楷':'阿里妈妈东方大楷','江城斜黑体':'江城斜黑体 900W'};
// 只返回缺失图层的新场景；调用方必须在用户点击后校验任务与封面版本再提交。
export async function recoverMissingCoverFonts(input,fonts,{loadFont,hasLocalFont}){
 const scene=JSON.parse(JSON.stringify(input)),checks=new Map(),replaced=[],repaired=[];
 const local=family=>{if(!checks.has(family))checks.set(family,hasLocalFont(family));return checks.get(family);};
 for(const layer of scene.layers){
  const style=layer.style,family=fontAliases[style.fontFamily]||style.fontFamily;
  const found=fonts.find(font=>font.id===style.fontId)||fonts.find(font=>font.label===family||font.family===style.fontFamily);
  let available=false;
  if(found){try{await loadFont(found);available=true;}catch{available=await local(found.family||style.fontFamily);}}
  else{
   available=await local(family);
   if(available&&style.fontId){
    // 用户明确恢复时仅移除已经失效的文件引用；本机仍有同名字体就保留原字形。
    repaired.push({layerId:layer.id,fontFamily:style.fontFamily,fontId:style.fontId});style.fontId='';delete style.renderFamily;
   }
  }
  if(!available)replaced.push({layerId:layer.id,fontFamily:style.fontFamily,fontId:style.fontId||''});
 }
 if(!replaced.length)return {scene,replaced,repaired,family:''};
 let family='';for(const name of ['Microsoft YaHei','微软雅黑'])if(await local(name)){family=name;break;}
 if(!family)throw Error('未确认本机可用的Microsoft YaHei或微软雅黑，当前封面未修改。请先安装或配置可用字体。');
 const ids=new Set(replaced.map(item=>item.layerId));
 for(const layer of scene.layers)if(ids.has(layer.id)){layer.style.fontFamily=family;layer.style.fontId='';delete layer.style.renderFamily;}
 return {scene,replaced,repaired,family};
}
