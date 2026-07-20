/**
 * 全系统统一的金额四舍五入规则：所有金额都是整数 cents，任何需要四舍五入的地方
 * （目前只有 Percentage commission 的计算）一律用这个函数，不要各自写 Math.round。
 * 用的是「四舍五入到最近的整数 cent」（.5 无条件往上），JS 原生 Math.round 就是这个行为。
 */
export function roundToNearestCent(value: number): number {
  return Math.round(value);
}
