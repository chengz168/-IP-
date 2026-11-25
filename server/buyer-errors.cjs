// 原始错误保留给本地诊断，面向买家的提示不显示堆栈、内部路径或命令行。
function buyerErrorMessage(error){
 const message=typeof error==='string'?error:error?.message;
 const fallback='操作未成功，请检查设置中的服务、模型与文件权限后重试；问题持续时请联系软件提供方。';
 if(typeof message!=='string'||!message.trim()||!/[\u4e00-\u9fff]/.test(message))return fallback;
 if(/(?:[A-Za-z]:[\\/]|\\\\)[^\s]*|\n\s*at\s|Traceback|\bat\s+[^\s]+\([^)]*:\d+/m.test(message))return fallback;
 return message.replace(/[\r\n]+/g,' ').slice(0,600);
}
module.exports={buyerErrorMessage};
