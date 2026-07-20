export function formatCents(cents: number | null | undefined): string {
  const value = ((cents ?? 0) / 100).toFixed(2);
  return `RM ${value}`;
}

export function ringgitToCents(value: number): number {
  return Math.round(value * 100);
}

export function centsToRinggit(cents: number | null | undefined): number {
  return (cents ?? 0) / 100;
}
