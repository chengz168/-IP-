const fs=require('node:fs');
const file='electron/preload.cjs',text=fs.readFileSync(file,'utf8'),before="'testConnection','checkLocalAsr','checkMedia'";
if(!text.includes(before))throw Error('未找到预期的桌面操作列表');
fs.writeFileSync(file,text.replace(before,"'testConnection','checkLocalAsr','checkLocalSpeech','checkMedia'"));
console.log('已补齐本地声音环境检查的桌面IPC入口。');
