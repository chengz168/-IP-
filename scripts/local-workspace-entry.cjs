// 先选择独立用户配置目录，再交给现有主进程处理单实例和全部业务。
const {app,dialog}=require('electron');
const path=require('node:path');
const {inspectWorkspace}=require('../server/local-workspace.cjs');
try{
 const workspace=process.argv.find(value=>value.startsWith('--studio-data-dir='))?.slice(18)||path.resolve(__dirname,'../workspaces/local-studio');
 inspectWorkspace(workspace);
 app.setPath('userData',path.join(workspace,'electron-profile'));
 if(!process.argv.some(value=>value.startsWith('--studio-data-dir=')))process.argv.push('--studio-data-dir='+workspace);
 require('../electron/main.cjs');
}catch(error){app.whenReady().then(()=>{dialog.showErrorBox('本地工作台启动失败',error.message);app.quit()})}
