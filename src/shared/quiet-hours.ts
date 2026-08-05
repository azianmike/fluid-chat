/**
 * Notification schedule ("quiet hours"). Windows are stored as local `HH:MM`
 * strings and evaluated in the person's own timezone, so 22:00–08:00 wraps
 * midnight correctly wherever they are.
 */
export type QuietHours = { start?: string | null; end?: string | null };

function minutesOfDay(value: string) {
  const [hours, minutes] = value.split(":").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function localMinutes(date: Date, timeZone?: string) {
  if (!timeZone) return date.getHours() * 60 + date.getMinutes();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(date);
    const hours = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
    const minutes = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
    return (hours % 24) * 60 + minutes;
  } catch {
    return date.getHours() * 60 + date.getMinutes();
  }
}

export function isWithinQuietHours(quiet: QuietHours | null | undefined, date = new Date(), timeZone?: string) {
  if (!quiet?.start || !quiet?.end) return false;
  const start = minutesOfDay(quiet.start);
  const end = minutesOfDay(quiet.end);
  if (start === null || end === null || start === end) return false;

  const now = localMinutes(date, timeZone);
  return start < end ? now >= start && now < end : now >= start || now < end;
}
