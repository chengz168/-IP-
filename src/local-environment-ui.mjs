const summaries={checking:'检查本地环境…',starting:'启动本地环境…',ready:'环境检查完成',degraded:'本地环境需处理',idle:'本地环境待检查'};
const statuses={checking:'检查中',starting:'启动中',ready:'服务已响应',failed:'需要处理','on-demand':'按任务加载',external:'外部服务'};
export function localEnvironmentSummary(report){return summaries[report?.status]||summaries.idle;}
export function localEnvironmentStatus(service){return statuses[service?.status]||'尚未检查';}
export function localEnvironmentConfig(value={}){return {autoStart:value.autoStart!==false,comfyRoot:value.comfyRoot||'',comfyPython:value.comfyPython||'',ollamaExecutable:value.ollamaExecutable||''};}
export function localEnvironmentBusy(report){return !!report?.checking||['checking','starting'].includes(report?.status);}
