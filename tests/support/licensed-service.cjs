// 既有业务测试显式注入隔离授权，不改变产品默认授权逻辑，也不进入发行包。
const {createService:realCreateService}=require('../../server/service.cjs');
function createService(root,secrets,options={}){
 const license=options.license||{info:()=>({activated:true,active:true,tier:'test',permanent:true,expiresAt:null,missingFactors:[],message:'隔离测试授权'}),assert:()=>true};
 return realCreateService(root,secrets,{...options,license});
}
module.exports={createService};
