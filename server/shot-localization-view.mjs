const fields=['visual','action','camera','sound'];
const limits={visual:6000,action:6000,camera:3000,sound:3000};
const own=(value,key)=>Object.hasOwn(value,key);
function sourceOf(shot){return Object.fromEntries(['id',...fields].map(key=>[key,typeof shot?.[key]==='string'?shot[key]:'']));}
// 普通英文即使夹在中文中也应翻译；技术缩写和可辨识品牌保留原名。
const preservedTerms=new Set(('PP PVC ABS PET PETG PE PS PU TPU PC TPE EVA POM PA PBT PLA PTFE LED OLED LCD RGB RGBW USB USB-C HDMI CPU GPU RAM ROM SSD HDD AI ASMR HDR UHD HD FHD QHD FPS ISO CAD NFC RFID UV IR WIFI WiFi Bluetooth iOS Android Windows macOS Apple Sony Nikon Canon DJI Huawei Xiaomi Samsung Lenovo ASUS Acer Dell DELL HP Epson GoPro Insta360 Leica Hasselblad Olympus Panasonic Fujifilm Pentax Zeiss Tamron Sigma MiniMax ComfyUI Qwen IndexTTS MuseTalk iPhone iPad MacBook AirPods LEGO DJI').split(' '));
function permittedTerms(source){
 const terms=new Set(preservedTerms);
 // 未收录品牌仅在原文明确标注身份时放行，不把 Static、Move 等普通首字母大写词当品牌。
 for(const match of source.matchAll(/(?:品牌|型号|brand|model)\s*[:：]?\s*([A-Za-z][A-Za-z0-9._-]*)|([A-Za-z][A-Za-z0-9._-]*)\s*(?:品牌|牌)/gi))terms.add(match[1]||match[2]);
 return terms;
}
function needsTranslation(value,source=value){
 if(typeof value!=='string'||!value.trim())return false;
 const allowed=permittedTerms(typeof source==='string'?source:'');
 return (value.match(/\b[A-Za-z][A-Za-z0-9]*(?:[-_.][A-Za-z0-9]+)*\b/g)||[]).some(token=>!allowed.has(token)&&!/[0-9]/.test(token)&&!(/^[A-Z]$/.test(token))&&!(/^(?:mm|cm|km|kg|mg|ml|oz|lb|fps|kHz|MHz|GHz|Hz|mAh|Wh|kWh|dB|dpi|px)$/).test(token));
}
function validateTranslation(value,source){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==fields.length||Object.keys(value).some(key=>!own(limits,key)))throw Error('中文译稿字段无效，全部旧设计已保留');
 for(const key of fields){
  if(typeof value[key]!=='string'||value[key].length>limits[key]||(source[key].trim()&&!value[key].trim()))throw Error('中文译稿缺失或过长，全部旧设计已保留');
  if(!needsTranslation(source[key])&&value[key]!==source[key])throw Error('无需翻译的中文字段被修改，全部旧设计已保留');
  if(needsTranslation(source[key])&&needsTranslation(value[key],source[key]))throw Error('模型仍返回英文镜头，全部旧设计已保留');
  // 数字与明确的型号、材料缩写不能被译稿悄悄替换。
  for(const token of source[key].match(/\b(?:\d+(?:\.\d+)?|[A-Z]{2,}[A-Z0-9-]*|[A-Za-z]+\d+[A-Za-z0-9-]*)\b/g)||[])if(!value[key].includes(token))throw Error('译稿遗漏原有数字或型号，全部旧设计已保留');
 }
 return value;
}

function translationRecordValid(record,shot){
 if(!record||record.shotId!==shot?.id||typeof record.sourceFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(record.sourceFingerprint)||JSON.stringify(record.source)!==JSON.stringify(sourceOf(shot)))return false;
 try{validateTranslation(record.translation,sourceOf(shot));return true;}catch{return false;}
}
function localizeShotView(shot,records={}){
 if(!shot)return {};
 const record=Object.entries(records).find(([key,value])=>key===shot.id+':'+value?.sourceFingerprint&&translationRecordValid(value,shot))?.[1];
 return record?{...shot,...Object.fromEntries(fields.map(key=>[key,record.translation[key]])),translated:true}:{...shot,translated:false};
}
export {fields,sourceOf,needsTranslation,validateTranslation,translationRecordValid,localizeShotView};
