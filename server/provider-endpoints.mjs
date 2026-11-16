// 新能力地址为空时沿用旧共享地址，发现、生成与快照共用同一回退规则。
export function capabilityBaseUrl(provider,capability){
 const field={text:'baseUrl',vision:'visionBaseUrl',tts:'ttsBaseUrl',asr:'asrBaseUrl'}[capability];
 return String(provider[field]||provider.baseUrl||'').trim();
}
