const path=require('node:path');
const {createService}=require('../server/service.cjs');
// 只配置本机已经实际验证的服务，保留现有任务及其他连接字段。
async function main(){const service=createService(path.resolve('data'));const current=service.store.data.settings;await service.invoke('saveSettings',{...current,mode:'own',provider:{...current.provider,baseUrl:'http://127.0.0.1:11434/v1',model:'qwen3.5:9b-q4_K_M',textProtocol:'ollama',textMaxTokens:'2048',ttsProtocol:'windows',systemVoice:'Microsoft Huihui Desktop'}});console.log('本地工作台已配置已安装的文本模型与中文系统朗读，现有任务保留。');}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
