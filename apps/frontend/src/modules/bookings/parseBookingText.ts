import dayjs, { type Dayjs } from "dayjs";

export interface ParsedLeg {
  pickupLocation?: string;
  dropoffLocation?: string;
  scheduledAt?: Dayjs;
  estimatedDurationMinutes?: number;
}

export interface ParsedBooking {
  girlName?: string;
  notes?: string;
  totalAmountCents?: number;
  legs?: ParsedLeg[];
}

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december"
];

/**
 * Mobile UAT Round 3 Bug Fix：这里之前只认得 "10.45pm"/"8:45pm" 这种一定要有分钟数、
 * 用 `.`/`:` 隔开的格式——像 "10pm"（没有分钟、口语常见写法）会直接被判定成「解析失败」，
 * 导致即使 Date/Pick up 两行文字都对得上，也因为 parseTimeOfDay 回传 null 而整个
 * departAt 算不出来，Pickup Date/Time 两个栏位就永远是空的。这里改成分钟数可省略
 * （省略就当整点），也支援没有 am/pm、纯 24 小时制的 "22:00"。
 */
function parseTimeOfDay(raw: string): { hour: number; minute: number } | null {
  const trimmed = raw.trim();

  const twelveHourMatch = trimmed.match(/^(\d{1,2})(?:[.:](\d{2}))?\s*([ap])\.?m\.?$/i);
  if (twelveHourMatch) {
    const hour12 = Number(twelveHourMatch[1]);
    const minute = twelveHourMatch[2] ? Number(twelveHourMatch[2]) : 0;
    if (hour12 < 1 || hour12 > 12 || minute > 59) return null;
    const isPm = twelveHourMatch[3].toLowerCase() === "p";
    const hour = (hour12 % 12) + (isPm ? 12 : 0);
    return { hour, minute };
  }

  const twentyFourHourMatch = trimmed.match(/^(\d{1,2})[.:](\d{2})$/);
  if (twentyFourHourMatch) {
    const hour = Number(twentyFourHourMatch[1]);
    const minute = Number(twentyFourHourMatch[2]);
    if (hour > 23 || minute > 59) return null;
    return { hour, minute };
  }

  return null;
}

/**
 * Mobile UAT Round 3：Date 栏位除了原本的 "26/7" 之外，也要认得 "26-7"、"26/07/2026"、
 * "26 July"、"today"、"tomorrow"。年份省略就用今年（跟原本行为一致）。
 */
function parseDateValue(raw: string): { year?: number; month: number; day: number } | null {
  const trimmed = raw.trim().toLowerCase();

  if (trimmed === "today") {
    const now = dayjs();
    return { year: now.year(), month: now.month() + 1, day: now.date() };
  }
  if (trimmed === "tomorrow") {
    const tomorrow = dayjs().add(1, "day");
    return { year: tomorrow.year(), month: tomorrow.month() + 1, day: tomorrow.date() };
  }

  const numericMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (numericMatch) {
    const day = Number(numericMatch[1]);
    const month = Number(numericMatch[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const yearRaw = numericMatch[3];
    const year = yearRaw ? (yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw)) : undefined;
    return { year, month, day };
  }

  const monthNameMatch = trimmed.match(/^(\d{1,2})\s+([a-z]+)$/);
  if (monthNameMatch) {
    const day = Number(monthNameMatch[1]);
    const monthName = monthNameMatch[2];
    const monthIndex = MONTH_NAMES.findIndex((name) => name.startsWith(monthName));
    if (monthIndex === -1 || day < 1 || day > 31) return null;
    return { month: monthIndex + 1, day };
  }

  return null;
}

function extractAddress(text: string): string | undefined {
  const lines = text.split(/\r?\n/);
  const addressLineIndex = lines.findIndex((line) => /^address\s*:?/i.test(line.trim()));
  if (addressLineIndex === -1) return undefined;

  for (let i = addressLineIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "" || /^=+$/.test(line)) continue;
    if (/^car\s*fee\s*:/i.test(line)) break;
    return line;
  }

  return undefined;
}

/**
 * 尽量识别贴上的派单文字，抓不到的栏位就留空，交给使用者手动补。
 * 格式参考：
 *   Date: 20/7
 *   Girl: Yoyo
 *   Pick up: 8.45pm
 *   Time: 9 hrs
 *   Collect: 1060
 *   Address:
 *   ====================
 *   Aera Service Residency Apartment
 *   ====================
 *   Car fee: 130
 */
export function parseBookingText(text: string): ParsedBooking {
  const result: ParsedBooking = {};

  const girlMatch = text.match(/Girl:\s*(.+)/i);
  if (girlMatch) {
    result.girlName = girlMatch[1].trim();
  }

  const collectMatch = text.match(/Collect:\s*(.+)/i);
  if (collectMatch) {
    result.notes = `Collect: ${collectMatch[1].trim()}`;
  }

  const carFeeMatch = text.match(/Car\s*fee:\s*([\d.]+)/i);
  if (carFeeMatch) {
    result.totalAmountCents = Math.round(Number(carFeeMatch[1]) * 100);
  }

  const address = extractAddress(text);

  const dateMatch = text.match(/Date:\s*(.+)/i);
  const pickupMatch = text.match(/Pick\s*up:\s*(.+)/i);
  const durationMatch = text.match(/Time:\s*([\d.]+)\s*hrs?/i);

  let departAt: Dayjs | undefined;
  if (dateMatch && pickupMatch) {
    const date = parseDateValue(dateMatch[1]);
    const time = parseTimeOfDay(pickupMatch[1]);
    if (date && time) {
      const year = date.year ?? dayjs().year();
      departAt = dayjs(new Date(year, date.month - 1, date.day, time.hour, time.minute));
    }
  }

  // "Time: 9 hrs" 是去程这趟工作预计花多久，填进去程的 Estimated Duration 栏位让使用者
  // 核对，前端会再用它跟 Pickup Time 一起自动算出回程的接送时间。
  const estimatedDurationMinutes = durationMatch ? Math.round(Number(durationMatch[1]) * 60) : undefined;

  const leg1: ParsedLeg = { dropoffLocation: address, scheduledAt: departAt, estimatedDurationMinutes };
  const leg2: ParsedLeg = { pickupLocation: address };

  const leg1HasData = Boolean(leg1.dropoffLocation || leg1.scheduledAt);
  const leg2HasData = Boolean(leg2.pickupLocation);

  if (leg1HasData || leg2HasData) {
    result.legs = [leg1, leg2];
  }

  return result;
}
