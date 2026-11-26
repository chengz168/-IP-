const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const defaults = {dailyRequests: 10, dailyTokens: 200000, failureThreshold: 3, retentionDays: 7};
const localProtocols = new Set(['ollama', 'comfyui', 'comfy-h3', 'comfy-h3-sequence', 'indextts-local', 'local-whisper', 'windows', 'musetalk-local']);
const fail = (code, message) => Object.assign(new Error(message), {code});
const integer = value => Number.isSafeInteger(value) && value >= 0;
const labels = {text: '文本', vision: '视觉'};

function usageTokens(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const total = integer(usage.total_tokens) ? usage.total_tokens : null;
  const sum = integer(usage.prompt_tokens) && integer(usage.completion_tokens) && integer(usage.prompt_tokens + usage.completion_tokens) ? usage.prompt_tokens + usage.completion_tokens : null;
  return total === null ? sum : sum === null ? total : Math.max(total, sum);
}

function createUsageGuard({root, now = () => new Date(), limits = {}, timeZone = 'Asia/Shanghai'} = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw fail('USAGE_CONFIG_INVALID', '用量数据目录未配置，请联系软件提供方');
  const file = path.join(root, 'usage.json'), lockFile = path.join(root, 'usage.lock');
  let formatter;
  try { formatter = new Intl.DateTimeFormat('sv-SE', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'}); }
  catch { throw fail('USAGE_CONFIG_INVALID', '用量统计时区无效，请联系软件提供方'); }
  function configuration() {
    const configured = typeof limits === 'function' ? limits() : limits;
    if (!configured || typeof configured !== 'object' || Array.isArray(configured)) throw fail('USAGE_CONFIG_INVALID', '云端额度配置无效，请检查额度设置');
    const value = {...defaults, ...configured};
    for (const field of Object.keys(defaults)) if (!Number.isSafeInteger(value[field]) || value[field] < 1 || value[field] > (field === 'retentionDays' ? 7 : 1000000000)) throw fail('USAGE_CONFIG_INVALID', '云端额度配置无效，请检查额度设置');
    return value;
  }
  function clock() {
    const date = new Date(now());
    if (!Number.isFinite(date.getTime())) throw fail('USAGE_CLOCK_INVALID', '系统时间无效，请校准系统时间后重试');
    return {day: formatter.format(date), at: date.toISOString()};
  }
  function load() {
    let state;
    try { state = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {version: 1, lastDay: '', days: {}}; throw fail('USAGE_READ_FAILED', '云端用量记录无法读取，请保留记录并联系软件提供方处理'); }
    try {
      if (state?.version !== 1 || typeof state.lastDay !== 'string' || state.lastDay && !/^\d{4}-\d{2}-\d{2}$/.test(state.lastDay) || !state.days || typeof state.days !== 'object' || Array.isArray(state.days)) throw Error();
      for (const [day, entry] of Object.entries(state.days)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !entry || !integer(entry.requests) || !integer(entry.tokens) || !integer(entry.reservedTokens) || !integer(entry.estimatedTokens) || !entry.reservations || typeof entry.reservations !== 'object' || Array.isArray(entry.reservations)) throw Error();
        for (const capability of ['text', 'vision']) if (!integer(entry.consecutiveFailures?.[capability]) || typeof entry.circuitOpen?.[capability] !== 'boolean') throw Error();
        let pending = 0, charged = 0, estimated = 0;
        for (const [id, item] of Object.entries(entry.reservations)) {
          if (!/^[\w-]{1,128}$/.test(id) || !['text', 'vision'].includes(item?.capability) || !integer(item.reservedTokens) || !['pending', 'succeeded', 'failed', 'cancelled'].includes(item.status)) throw Error();
          if (item.status === 'pending') pending += item.reservedTokens;
          else {
            if (!integer(item.tokens) || typeof item.estimated !== 'boolean') throw Error();
            charged += item.tokens;
            if (item.estimated) estimated += item.tokens;
          }
        }
        if (!integer(pending) || !integer(charged) || !integer(estimated) || pending !== entry.reservedTokens || charged !== entry.tokens || estimated !== entry.estimatedTokens || Object.keys(entry.reservations).length !== entry.requests) throw Error();
      }
      return state;
    } catch { throw fail('USAGE_READ_FAILED', '云端用量记录格式无效，请保留记录并联系软件提供方处理'); }
  }
  function save(state) {
    const temporary = file + '.' + crypto.randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', {flag: 'wx', mode: 0o600});
      fs.renameSync(temporary, file);
    } catch { throw fail('USAGE_SAVE_FAILED', '云端用量保存失败，请检查磁盘空间和文件权限后重试；本次不再提交新请求'); }
    finally { try { fs.rmSync(temporary, {force: true}); } catch { /* 清理失败不覆盖写盘错误。 */ } }
  }
  function transaction(work) {
    let descriptor, owner = crypto.randomUUID();
    try {
      fs.mkdirSync(root, {recursive: true});
      try { descriptor = fs.openSync(lockFile, 'wx', 0o600); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        // 活进程锁不等待；让调用方明确重试，不能并发覆盖账本。
        let held;
        try { held = JSON.parse(fs.readFileSync(lockFile, 'utf8')); }
        catch (readError) {
          if (readError.code === 'ENOENT' || readError instanceof SyntaxError) throw fail('USAGE_BUSY', '云端用量正在更新，请稍后重试');
          throw readError;
        }
        if (!Number.isInteger(held.pid) || held.pid <= 0) throw fail('USAGE_BUSY', '云端用量正在更新，请稍后重试');
        let alive = true;
        try { process.kill(held.pid, 0); } catch (probe) { if (probe.code === 'ESRCH') alive = false; }
        if (alive) throw fail('USAGE_BUSY', '云端用量正在更新，请稍后重试');
        // 仅回收已确认退出的进程留下的锁，不按年龄抢占活进程。
        try {
          if (fs.readFileSync(lockFile, 'utf8') !== JSON.stringify(held)) throw fail('USAGE_BUSY', '云端用量正在更新，请稍后重试');
          fs.unlinkSync(lockFile);
          descriptor = fs.openSync(lockFile, 'wx', 0o600);
        } catch (reclaimError) {
          // 回收期间锁可能已被释放或由其他进程重建；只将明确竞争视为繁忙。
          if (reclaimError.code === 'ENOENT' || reclaimError.code === 'EEXIST') throw fail('USAGE_BUSY', '云端用量正在更新，请稍后重试');
          throw reclaimError;
        }
      }
      fs.writeFileSync(descriptor, JSON.stringify({pid: process.pid, owner}));
      const state = load(), configurationValue = configuration(), current = clock();
      // 调回日期不能再次获得当天新额度；本地文件可被管理员改写，不能声称防篡改。
      if (state.lastDay && current.day < state.lastDay) throw fail('USAGE_CLOCK_REVERSED', '系统日期早于已有用量记录，请校准系统日期后重试');
      state.lastDay = current.day;
      const cutoff = new Date(Date.parse(current.day + 'T00:00:00Z') - (configurationValue.retentionDays - 1) * 86400000).toISOString().slice(0, 10);
      for (const day of Object.keys(state.days)) if (day < cutoff) delete state.days[day];
      const result = work(state, configurationValue, current);
      save(state);
      return result;
    } catch (error) {
      if (error.code?.startsWith('USAGE_')) throw error;
      throw fail('USAGE_SAVE_FAILED', '云端用量记录暂不可用，请检查磁盘空间和文件权限后重试');
    } finally {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch { /* 描述符关闭不影响原始异常。 */ }
        try { if (JSON.parse(fs.readFileSync(lockFile, 'utf8')).owner === owner) fs.unlinkSync(lockFile); } catch { /* 不移除其他进程的锁。 */ }
      }
    }
  }
  function entry(state, day) {
    return state.days[day] ||= {requests: 0, tokens: 0, reservedTokens: 0, estimatedTokens: 0, consecutiveFailures: {text: 0, vision: 0}, circuitOpen: {text: false, vision: false}, reservations: {}};
  }
  function reserve({capability, protocol, reservedTokens} = {}) {
    if (!['text', 'vision'].includes(capability)) throw fail('USAGE_INVALID_INPUT', '云端用量能力无效，请选择文本或视觉能力');
    if (localProtocols.has(protocol)) return {id: '', day: '', capability, local: true};
    if (protocol !== 'compatible') throw fail('USAGE_INVALID_INPUT', '云端模型协议未确认，请检查模型设置后重试');
    if (!Number.isSafeInteger(reservedTokens) || reservedTokens <= 0) throw fail('USAGE_INVALID_INPUT', '云端请求预算无效，请配置输入与输出的token预留量后重试');
    return transaction((state, config, current) => {
      const row = entry(state, current.day);
      if (row.circuitOpen[capability]) throw fail('USAGE_CIRCUIT_OPEN', '云端' + labels[capability] + '服务连续失败，今日已暂停调用；请检查服务配置，次日自动恢复');
      if (row.requests >= config.dailyRequests) throw fail('USAGE_REQUEST_LIMIT', '今日云端生成次数已达上限，请次日再试或使用本地模型');
      if (row.tokens + row.reservedTokens + reservedTokens > config.dailyTokens) throw fail('USAGE_TOKEN_LIMIT', '今日云端token额度不足，请缩短输入、降低输出上限或使用本地模型');
      const id = crypto.randomUUID();
      row.requests++;
      row.reservedTokens += reservedTokens;
      row.reservations[id] = {capability, reservedTokens, status: 'pending', createdAt: current.at};
      return {id, day: current.day, capability, local: false};
    });
  }
  function settle(ticket, usage, status, {cancelled = false, upstreamFailure = true} = {}) {
    if (ticket?.local === true) return {local: true, settled: true};
    if (!ticket || typeof ticket.id !== 'string' || !/^[\w-]{1,128}$/.test(ticket.id) || !/^\d{4}-\d{2}-\d{2}$/.test(ticket.day) || !['text', 'vision'].includes(ticket.capability)) throw fail('USAGE_INVALID_INPUT', '云端用量凭据无效，请保留任务记录并联系软件提供方');
    return transaction((state, config, current) => {
      const row = state.days[ticket.day], item = row?.reservations[ticket.id];
      if (!item || item.capability !== ticket.capability) throw fail('USAGE_TICKET_MISSING', '云端用量凭据已失效，请保留任务记录并联系软件提供方');
      if (item.status !== 'pending') return {local: false, settled: true, duplicate: true, tokens: item.tokens, estimated: item.estimated, status: item.status};
      const reported = usageTokens(usage), tokens = reported ?? item.reservedTokens;
      if (!integer(row.tokens + tokens)) throw fail('USAGE_INVALID_INPUT', '云端服务返回的token用量超出可记录范围，请联系软件提供方');
      row.reservedTokens -= item.reservedTokens;
      row.tokens += tokens;
      if (reported === null) row.estimatedTokens += tokens;
      Object.assign(item, {status: cancelled ? 'cancelled' : status, settledAt: current.at, tokens, estimated: reported === null});
      if (status === 'succeeded') row.consecutiveFailures[ticket.capability] = 0;
      else if (!cancelled && upstreamFailure) row.consecutiveFailures[ticket.capability]++;
      if (row.consecutiveFailures[ticket.capability] >= config.failureThreshold) row.circuitOpen[ticket.capability] = true;
      // 超时或取消不证明上游未计费；缺usage保守记预留，不能退款后继续透支。
      return {local: false, settled: true, duplicate: false, tokens, estimated: reported === null, status: item.status, exceeded: row.tokens + row.reservedTokens > config.dailyTokens};
    });
  }
  return {
    reserve,
    succeed: (ticket, usage) => settle(ticket, usage, 'succeeded'),
    fail: (ticket, options = {}) => settle(ticket, options.usage, 'failed', options),
    info: () => transaction((state, config, current) => ({day: current.day, timeZone, limits: config, ...structuredClone(entry(state, current.day))}))
  };
}

module.exports = {createUsageGuard, usageTokens, defaults};
