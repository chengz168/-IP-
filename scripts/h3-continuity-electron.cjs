const path=require('node:path');
// 衔接对照使用单独窗口和用户数据，不操作用户原业务窗口。
require('electron').app.setPath('userData',path.resolve(__dirname,'../evidence/validation/h3-continuity/electron-profile'));
require('../electron/main.cjs');
