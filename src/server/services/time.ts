const UNITS: Record<string, number> = {
  s: 1000,
  sec: 1000,
  secs: 1000,
  second: 1000,
  seconds: 1000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
  w: 604_800_000,
  week: 604_800_000,
  weeks: 604_800_000
};

/**
 * Understands the handful of phrasings people actually type into `/remind`
 * and the "schedule send" menu: `in 20 minutes`, `tomorrow at 9am`, `at 17:30`.
 * Returns null when nothing sensible can be parsed so callers can explain why.
 */
export function parseWhen(input: string, now = new Date()): { at: Date; rest: string } | null {
  const text = input.trim().toLowerCase();

  const relative = /(?:^|\bin\s+)(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w)\b/.exec(text);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = UNITS[relative[2]];
    if (unit) {
      return {
        at: new Date(now.getTime() + amount * unit),
        rest: text.replace(relative[0], "").trim()
      };
    }
  }

  const timeMatch = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/.exec(text);
  const dayOffset = /\btomorrow\b/.test(text) ? 1 : /\bnext week\b/.test(text) ? 7 : /\btoday\b/.test(text) ? 0 : null;

  if (timeMatch && (dayOffset !== null || /\bat\b/.test(text))) {
    const at = new Date(now);
    let hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2] ?? 0);
    const meridiem = timeMatch[3];
    if (meridiem === "pm" && hours < 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    at.setDate(at.getDate() + (dayOffset ?? 0));
    at.setHours(hours, minutes, 0, 0);
    if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
    return {
      at,
      rest: text.replace(timeMatch[0], "").replace(/\b(tomorrow|today|next week)\b/, "").trim()
    };
  }

  if (dayOffset !== null) {
    const at = new Date(now);
    at.setDate(at.getDate() + dayOffset);
    at.setHours(9, 0, 0, 0);
    return { at, rest: text.replace(/\b(tomorrow|today|next week)\b/, "").trim() };
  }

  return null;
}

export function formatDuration(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}
