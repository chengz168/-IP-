// 桌面IPC的包装信息与文件路径不适合作为用户恢复操作的提示。
export function operationErrorMessage(error){
 const message=String(error?.message||error||'操作失败').replace(/^Error invoking remote method '[^']+': (?:Error: )?/u,'');
 if(/^(?:EPERM|EACCES|EBUSY|ENOSPC|EIO):/u.test(message))return '文件操作失败，请检查文件权限、占用情况或磁盘空间后重试。';
 return message;
}
