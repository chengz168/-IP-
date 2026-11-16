const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createService}=require('../server/service.cjs');
const source=fs.readFileSync('src/components/ResourceStudio.vue','utf8'),code=source.slice(source.indexOf('function cleanup()'),source.indexOf('async function voiceOperation'));
const report={checkedAt:new Date().toISOString(),checks:[],scope:'修改前隔离执行原录音函数，不采集麦克风、不改用户工作区'};
function fixture(){
 const streams=[],requests=[],recorders=[],readers=[],calls=[];let unmount;
 class Recorder{constructor(stream){this.stream=stream;this.state='inactive';this.mimeType='audio/webm';recorders.push(this);}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['录音字节'])});this.onstop?.();}}
 const context={recording:{value:false},recordTime:{value:0},sampleWorking:{value:false},busy:{value:''},draft:{value:{id:'first'}},uploadTab:{value:'record'},mounted:true,Blob,MediaRecorder:Recorder,FileReader:class{constructor(){readers.push(this);}readAsDataURL(){this.result='data:audio/webm;base64,YQ==';}},navigator:{mediaDevices:{getUserMedia:()=>new Promise(resolve=>requests.push(resolve))}},onUnmounted:fn=>unmount=fn,clearInterval(){},setInterval(){return 1;},notify(){},selectedSample(){},refresh:async()=>{},call:async(...args)=>{calls.push(args);return {id:'audio'};}};
 vm.createContext(context);vm.runInContext(code+'\nglobalThis.start=record;',context);
 const stream=()=>{const track={stopped:false,stop(){this.stopped=true;}};const result={getTracks:()=>[track],track};streams.push(result);return result;};
 return {context,requests,streams,stream,recorders,readers,calls,unmount:()=>unmount()};
}
(async()=>{
 let f=fixture(),a=f.context.start(),b=f.context.start();f.requests[0](f.stream());await a;f.requests[1](f.stream());await b;report.checks.push({issue:'权限等待可重复申请',requests:f.requests.length,activeRecorders:f.recorders.filter(r=>r.state==='recording').length});f.context.uploadTab.value='upload';report.checks.push({issue:'切换上传标签后仍录制',recording:f.context.recording.value});f.unmount();report.checks.push({issue:'重复申请后卸载仅关闭最后流',remainingActiveTracks:f.streams.filter(s=>!s.track.stopped).length});
 f=fixture();a=f.context.start();f.requests[0](f.stream());await a;await f.context.start();f.unmount();f.readers[0].onload();await new Promise(r=>setImmediate(r));report.checks.push({issue:'停止后读文件期间卸载仍提交导入',importsAfterUnmount:f.calls.filter(c=>c[0]==='importFile').length});
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'superip-record-before-'));try{const service=createService(root);service.media.probe=async()=>{throw Error('无效音频');};const asset=await service.invoke('importFile',{name:'recording.webm',base64:Buffer.from('无效容器').toString('base64')});report.checks.push({issue:'无效录音通用导入仍保留素材',assetCount:service.store.data.assets.length,probeError:asset.probeError});}finally{fs.rmSync(root,{recursive:true,force:true});}
 const output=path.resolve('evidence/validation/microphone-recording');fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'before-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
