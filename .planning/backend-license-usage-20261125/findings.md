# 核实事实与设计决定

- 附件已完整读取，当前未提交变更均是拆镜相关文件，与本批无关；不覆盖、不提交。
- provider-keys.cjs现有safeStorage同步接口+唯一临时文件+rename原子替换可复用模式；本模块保留中文可执行错误，不泄露内部路径。
- service root从createService传入，本模块只使用注入root。未激活白名单为state/licenseActivate/licenseInfo/saveLocalEnvironment/checkMedia。
- 激活码拟定SIP1.payloadBase64url.signatureBase64url，签名内容为ASCII SIP1.payloadBase64url；因素按主板、BIOS、CPU固定顺序。缺失因子以16位0占位，不参与匹配。
- 永久expiresAt=null；3650天有限期。此条按本轮负责人明确要求覆盖附件中矛盾描述。
- 正式公钥由负责人准备并注入或写license-public-key.cjs，本模块测试使用内存临时密钥，绝不生成正式激活文件。
- 云端text/vision共享日请求/token池，熔断按能力；调用前预留，成功/失败结算必须幂等。缺usage不能按0抹掉成本，保守计预留并明确估算。
