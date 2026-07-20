import dayjs, { type Dayjs } from "dayjs";

export interface ParsedLeg {
  pickupLocation?: string;
  dropoffLocation?: string;
  scheduledAt?: Dayjs;
}

export interface ParsedBooking {
  girlName?: string;
  notes?: string;
  totalAmountCents?: number;
  legs?: ParsedLeg[];
}

function parseTimeOfDay(raw: string): { hour: number; minute: number } | null {
  const match = raw.trim().match(/^(\d{1,2})[.:](\d{2})\s*([ap])m$/i);
  if (!match) return null;

  const hour12 = Number(match[1]);
  const minute = Number(match[2]);
  const isPm = match[3].toLowerCase() === "p";
  const hour = (hour12 % 12) + (isPm ? 12 : 0);
  return { hour, minute };
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

  const dateMatch = text.match(/Date:\s*(\d{1,2})\/(\d{1,2})/i);
  const pickupMatch = text.match(/Pick\s*up:\s*([\d.:]+\s*[ap]m)/i);
  const durationMatch = text.match(/Time:\s*([\d.]+)\s*hrs?/i);

  let departAt: Dayjs | undefined;
  if (dateMatch && pickupMatch) {
    const day = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const time = parseTimeOfDay(pickupMatch[1]);
    if (time) {
      const year = dayjs().year();
      departAt = dayjs(new Date(year, month - 1, day, time.hour, time.minute));
    }
  }

  let returnAt: Dayjs | undefined;
  if (departAt && durationMatch) {
    const durationMinutes = Math.round(Number(durationMatch[1]) * 60);
    returnAt = departAt.add(durationMinutes, "minute");
  }

  const leg1: ParsedLeg = { dropoffLocation: address, scheduledAt: departAt };
  const leg2: ParsedLeg = { pickupLocation: address, scheduledAt: returnAt };

  const leg1HasData = Boolean(leg1.dropoffLocation || leg1.scheduledAt);
  const leg2HasData = Boolean(leg2.pickupLocation || leg2.scheduledAt);

  if (leg1HasData || leg2HasData) {
    result.legs = [leg1, leg2];
  }

  return result;
}
