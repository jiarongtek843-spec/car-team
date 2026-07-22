// 默认值跟 CompanySettings.currency 的 schema default 保持一致，只在设定还没加载完成
// （例如刚登入、Company Settings 还没抓回来）时当保底显示，不是永久写死的值——
// CompanySettingsProvider 加载完成后会用 setCurrencyPrefix 覆盖成实际设定的币别。
let currencyPrefix = "RM";

export function setCurrencyPrefix(prefix: string) {
  currencyPrefix = prefix;
}

export function formatCents(cents: number | null | undefined): string {
  const value = ((cents ?? 0) / 100).toFixed(2);
  return `${currencyPrefix} ${value}`;
}

export function ringgitToCents(value: number): number {
  return Math.round(value * 100);
}

export function centsToRinggit(cents: number | null | undefined): number {
  return (cents ?? 0) / 100;
}
