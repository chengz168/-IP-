import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
// 生成中的音视频会被工作器独占，开发服务器只监听源码，避免Windows媒体文件锁使监听器退出。
export default defineConfig({plugins:[vue()],base:'./',build:{rollupOptions:{input:{main:'index.html',cover:'cover-worker.html'}}},server:{watch:{ignored:['**/release/**','**/evidence/**','**/workspaces/**','**/data/**','**/outputs/**','**/output/**','**/tmp/**','**/.research-venv/**']},port:5173,strictPort:true,proxy:{'/api':'http://127.0.0.1:5174','/media':'http://127.0.0.1:5174'}}});
