const path=require('node:path');
const fs=require('node:fs');
// 单独的源码验收窗口，避免关闭或导航用户原来的工作区。
const directory=path.resolve('evidence/validation/local-generation/electron-profile');
fs.mkdirSync(directory,{recursive:true});
require('electron').app.setPath('userData',directory);
require('../electron/main.cjs');
