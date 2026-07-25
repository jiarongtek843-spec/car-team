// TEMPORARY DEBUG LOGGING（Mobile UAT Bug Fix：Driver Online 状态在真实手机上还是回报
// Offline，需要不靠人工去 Railway Dashboard 复制 log 就能直接读到 request/response 证据）。
// 纯内存 ring buffer，进程重启就清空，不写 DB、不影响任何业务逻辑。诊断完成后要整段移除，
// 不是永久保留的机制。
const MAX_ENTRIES = 200;
const entries: { label: string; data: Record<string, unknown>; at: string }[] = [];

export function pushDebugLog(label: string, data: Record<string, unknown>) {
  entries.push({ label, data, at: new Date().toISOString() });
  if (entries.length > MAX_ENTRIES) {
    entries.shift();
  }
}

export function getDebugLog() {
  return entries;
}
