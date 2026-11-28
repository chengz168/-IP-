// 参考学习可以使用长访谈；媒体接入与报告采样共用时长边界，避免下载成功后再次被旧限制拦截。
const MAX_REFERENCE_SECONDS=60*60;
function validateReferenceDuration(value,label='参考媒体'){
 const duration=Number(value);
 if(!Number.isFinite(duration)||duration<=0)throw Error(label+'没有可读取的有效时长，请检查媒体文件');
 if(duration>MAX_REFERENCE_SECONDS)throw Error(label+'时长为'+(duration/60).toFixed(2)+'分钟，当前支持不超过60分钟；请截取需要分析的片段');
 return duration;
}
module.exports={MAX_REFERENCE_SECONDS,validateReferenceDuration};
