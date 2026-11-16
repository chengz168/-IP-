const path=require('node:path');
// 隔离源码窗口使用独立配置和单实例锁，不导航或关闭用户当前窗口。
require('electron').app.setPath('userData',path.resolve(__dirname,'../evidence/validation/h3-submit-discovery/electron-profile'));
require('../electron/main.cjs');
