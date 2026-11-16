const fs=require('node:fs');
function replace(file,from,to){const text=fs.readFileSync(file,'utf8');if(!text.includes(from))throw Error('找不到预期修改位置：'+file);fs.writeFileSync(file,text.replace(from,to));}
replace('server/service.cjs',"'ttsClassicModel','ttsFastModel']","'ttsClassicModel','ttsFastModel','indexttsHome']");
replace('server/service.cjs',"    checkLocalAsr:async()=>providers.localAsr().check(),","    checkLocalAsr:async()=>providers.localAsr().check(),\n    checkLocalSpeech:async()=>providers.localIndexTTS().check(),");
replace('src/views/SettingsView.vue',"async function checkAsr(){", "async function checkLocalSpeech(){if(!await save())return;const r=await act('检查本地声音环境',()=>call('checkLocalSpeech'));if(r)showDialog('本地声音环境检查通过','CUDA '+r.cuda+' · Torch '+r.torch+'\\n模型文件齐备；此检查不代表真实生成或听感验收通过。');}\nasync function checkAsr(){");
replace('src/views/SettingsView.vue','<option value="compatible">兼容语音服务</option><option value="windows">Windows系统朗读</option>', '<option value="compatible">兼容语音服务</option><option value="indextts-local">IndexTTS 本地声音</option><option value="windows">Windows系统朗读</option>');
replace('src/views/SettingsView.vue',"<template v-if=\"config.provider.ttsProtocol==='windows'\"><p class=\"hint\">使用本机已安装", "<template v-if=\"config.provider.ttsProtocol==='indextts-local'\"><label class=\"settings-field\">本地声音环境路径<input v-model=\"config.provider.indexttsHome\" placeholder=\"D:/AI-Runtimes/super-ip/indextts-2.5\" aria-label=\"本地声音环境路径\"/></label><button :disabled=\"!!busy\" @click=\"checkLocalSpeech\">检查本地声音环境</button><p class=\"hint\">使用已保存的声音样本生成新配音，支持情绪向量和语速。首次加载模型需要等待，实际效果以试听为准。</p></template><template v-if=\"config.provider.ttsProtocol==='windows'\"><p class=\"hint\">使用本机已安装");
replace('src/use-voice-controls.mjs',"label:capabilities.value.windows?'使用设置中的系统音色':'使用设置中的服务音色'","label:capabilities.value.windows?'使用设置中的系统音色':capabilities.value.local?'请选择本地参考声音':'使用设置中的服务音色'");
replace('src/use-voice-controls.mjs',"label:v.name+(!v.remoteId?'（仅样本，未训练）':'')","label:v.name+(capabilities.value.local&&v.sampleId?'（本地样本）':!v.remoteId?'（仅样本，未训练）':'')");
replace('src/components/VoicePanel.vue',"{{generationReason||(capabilities.windows?", "{{generationReason||(capabilities.local?'本地 IndexTTS · 支持情绪向量和语速':capabilities.windows?");
const file='package.json',data=JSON.parse(fs.readFileSync(file,'utf8'));
data.build.files.push('integrations/indextts-local/**/*');
data.build.asarUnpack.push('server/local-indextts.py','integrations/indextts-local/**/*');
fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');
console.log('已接入本地声音设置、能力路由和打包资源，未更改用户工作区配置。');
