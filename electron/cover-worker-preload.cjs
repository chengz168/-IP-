const {contextBridge,ipcRenderer}=require('electron');
const pending=new Map();let serial=0;
ipcRenderer.on('studio:cover-read:reply',(_,id,error,value)=>{const result=pending.get(id);if(!result)return;pending.delete(id);if(error)result.reject(new Error(error));else result.resolve(value);});
contextBridge.exposeInMainWorld('studio',{invoke:(action,data)=>new Promise((resolve,reject)=>{const requestId=++serial;pending.set(requestId,{resolve,reject});ipcRenderer.send('studio:cover-read',action,{requestId,data});})});
