const path=require('node:path');
// 独立长片验收窗口，保留用户原窗口及原工作区。
require('electron').app.setPath('userData',path.resolve(__dirname,'../evidence/validation/h3-long-generation/electron-profile'));
require('../electron/main.cjs');
