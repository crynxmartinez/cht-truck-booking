/** 6 -> "6 AM", 14 -> "2 PM". The pickup text hour is configurable, so copy must not hard-code it. */
export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
}
