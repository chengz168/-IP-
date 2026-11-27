import {createApp} from 'vue';
import App from './App.vue';
import './style.css';
import './legacy.css';
import './resources.css';
import './layout.css';
import './cover.css';
import './task-center.css';
import './typography.css';
createApp(App).mount('#app');

import './workflow-jobs.css';
import './alignment.css';

import './title.css';
import './brain.css';
import './copy-studio.css';
import './materials.css';
import './video.css';

import './voice.css';
import './prompts.css';

import './recording.css';
import './edit-preview.css';

import './namecard.css';
import './bgm.css';
import './product-studio.css';

// 最后加载工作台统一样式，业务组件保持原有逻辑。
import './studio-ui.css';
