/**
 * Mobile UAT Round 3 Bug Fix：Settlement History 之前直接对 `new Date(value)` 呼叫
 * `.toLocaleDateString()`，如果 value 是 undefined/null（栏位打错名字、或 API 真的没有
 * 这个值）或格式不合法，`new Date()` 会得到 Invalid Date，画面上就直接显示英文的
 * "Invalid Date"。这里统一包一层：拿不到值或解析失败都回传 "-"，不会再显示这种
 * 使用者看不懂的字样。
 */
export function formatDateSafe(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
}

export function formatDateTimeSafe(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}
