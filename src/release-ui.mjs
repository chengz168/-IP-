// 新增发行版界面只展示可执行中文提示，技术路径仍保留在可编辑的设置字段中。
export function releaseMessage(value,fallback='操作未能完成，请检查设置后重试。'){
 const message=String(value?.message??value??'').replace(/^Error invoking remote method '[^']+': (?:Error: )?/u,'').trim();
 if(!message||!/[\u3400-\u9fff]/u.test(message)||/(?:[a-z]:[\\/]|\\\\|file:\/\/|(?:^|\s)\/(?:Users|home|tmp|var|usr)\/|\n\s*at\s|Error:|Traceback)/iu.test(message))return fallback;
 return message;
}
export const environmentCategories=[
 {id:'text',name:'文案服务',guide:'前往设置 → 模型设置 → 文本模型，选择来源并填写服务地址和已有模型。'},
 {id:'asr',name:'文字识别',guide:'前往设置 → 模型设置 → 语音识别，填写已有 Python 解释器与 Whisper 模型目录，或配置识别服务。'},
 {id:'tts',name:'配音',guide:'前往设置 → 模型设置 → 语音合成方式，选择系统音色或填写本地声音环境路径。'},
 {id:'avatar',name:'数字人',guide:'前往设置 → 模型设置 → 独立能力服务桥，填写本地口型环境路径或服务地址。'},
 {id:'media',name:'FFmpeg',guide:'前往设置 → 常规设置 → 媒体工具，填写 FFmpeg 与 FFprobe 程序的完整路径。'},
 {id:'fonts',name:'字幕字体',guide:'前往设置 → 常规设置 → 字幕字体，填写已有字体所在目录。'}
];
export function environmentItems(report){
 return environmentCategories.map(category=>{
  const item=report?.items?.find(item=>item.id===category.id),status=['ready','missing','startable'].includes(item?.status)?item.status:'missing';
  return {...category,status,message:releaseMessage(item?.message,item?'请按下方指引检查设置后重试。':'尚未取得检查结果，请重新检查。'),guide:releaseMessage(item?.guide,category.guide)};
 });
}
export function environmentCanCreate(report){return report?.canCreate===true&&report.items?.find(item=>item.id==='text')?.status==='ready';}
export function licenseDate(value){
 if(!value)return '暂无可靠信息';
 const date=new Date(value);return Number.isNaN(date.getTime())?'暂无可靠信息':date.toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'});
}
export function missingFactorNames(value){
 const names={baseboard:'主板',board:'主板',baseBoard:'主板',bios:'BIOS',processor:'处理器',cpu:'处理器',BaseBoard:'主板',BIOS:'BIOS',Processor:'处理器'};
 return Array.isArray(value)?value.map(item=>names[item]||'系统硬件信息').join('、'):'';
}
