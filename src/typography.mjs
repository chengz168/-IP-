// 数值已与原软件的四档界面配置及实际切换核对；媒体文字不使用这些变量。
export const fontPresets=Object.freeze([
  {id:'compact',label:'紧凑',scale:1,micro:11,meta:12,caption:12,secondary:13,body:14,control:14,cardTitle:16,sectionTitle:20,pageTitle:24},
  {id:'standard',label:'标准',scale:1.07,micro:12,meta:13,caption:13,secondary:14,body:15,control:15,cardTitle:17,sectionTitle:21,pageTitle:26},
  {id:'comfortable',label:'舒适',scale:1.14,micro:12,meta:13,caption:14,secondary:15,body:16,control:16,cardTitle:18,sectionTitle:22,pageTitle:28},
  {id:'large',label:'大',scale:1.29,micro:14,meta:15,caption:16,secondary:17,body:18,control:18,cardTitle:20,sectionTitle:26,pageTitle:32}
].map(Object.freeze));
export const normalizeFontSize=id=>fontPresets.some(preset=>preset.id===id)?id:'comfortable';
export function typographyVariables(id){
  const preset=fontPresets.find(preset=>preset.id===normalizeFontSize(id));
  return Object.fromEntries(Object.entries(preset).filter(([key])=>!['id','label'].includes(key)).map(([key,value])=>[key==='scale'?'--app-font-scale':'--app-font-size-'+key.replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase()),String(value)+(key==='scale'?'':'px')]));
}
export function applyTypography(id,root=document.documentElement){
  const normalized=normalizeFontSize(id);for(const [key,value]of Object.entries(typographyVariables(normalized)))root.style.setProperty(key,value);root.dataset.fontSize=normalized;
}
