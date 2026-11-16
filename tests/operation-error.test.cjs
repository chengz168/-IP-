const test=require('node:test'),assert=require('node:assert/strict');

test('IPC前缀清理而保留具体业务错误和下一步提示',async()=>{
 const {operationErrorMessage}=await import('../src/operation-error.mjs');assert.equal(operationErrorMessage(Error("Error invoking remote method 'studio:invoke': Error: 文案输入已变化，请重新确认")),'文案输入已变化，请重新确认');assert.equal(operationErrorMessage(Error('请选择本地声音')),'请选择本地声音');
});

test('文件读写错误不暴露系统路径，明确给出可执行的恢复步骤',async()=>{
 const {operationErrorMessage}=await import('../src/operation-error.mjs');for(const code of ['EPERM','EACCES','EBUSY','ENOSPC','EIO']){const value=operationErrorMessage(Error("Error invoking remote method 'studio:invoke': Error: "+code+": operation failed, rename 'D:\\private\\studio.json.tmp'"));assert.match(value,/检查文件权限.*占用.*磁盘空间.*重试/);assert.doesNotMatch(value,/Error invoking|private|EPERM|[A-Z]:\\/);}
});
