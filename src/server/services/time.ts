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
 * How far ahead of UTC a zone is at a given instant, in milliseconds. Same
 * `Intl` round-trip the notification schedule uses, so both agree on what
 * "9am for this person" means — DST included.
 */
function zoneOffsetMs(date: Date, timeZone: string) {
  if (timeZone === "UTC") return 0;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).formatToParts(date);
    const field = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
    const wall = Date.UTC(
      field("year"),
      field("month") - 1,
      field("day"),
      field("hour") % 24,
      field("minute"),
      field("second")
    );
    return wall - Math.floor(date.getTime() / 1000) * 1000;
  } catch {
    // An unrecognised zone name behaves as UTC rather than throwing.
    return 0;
  }
}

/**
 * Turns a wall-clock reading back into a real instant. The offset is sampled
 * twice because the target can sit on the far side of a DST change from now.
 */
function toInstant(wall: Date, timeZone: string) {
  const approximate = new Date(wall.getTime() - zoneOffsetMs(wall, timeZone));
  return new Date(wall.getTime() - zoneOffsetMs(approximate, timeZone));
}

/**
 * Understands the handful of phrasings people actually type into `/remind`
 * and the "schedule send" menu: `in 20 minutes`, `tomorrow at 9am`, `at 17:30`.
 * Returns null when nothing sensible can be parsed so callers can explain why.
 *
 * `timeZone` is the person's own — "tomorrow at 9am" has to mean 9am where they
 * are, not wherever the server process happens to run.
 */
export function parseWhen(
  input: string,
  options: { now?: Date; timeZone?: string } = {}
): { at: Date; rest: string } | null {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone || "UTC";
  const text = input.trim().toLowerCase();

  // A relative offset is the same length of time in every zone.
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

  // Shifting the instant by the zone offset puts `now` into the person's own
  // wall clock, so the plain UTC setters below do the calendar arithmetic there.
  const wall = new Date(now.getTime() + zoneOffsetMs(now, timeZone));

  if (timeMatch && (dayOffset !== null || /\bat\b/.test(text))) {
    let hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2] ?? 0);
    const meridiem = timeMatch[3];
    if (meridiem === "pm" && hours < 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    wall.setUTCDate(wall.getUTCDate() + (dayOffset ?? 0));
    wall.setUTCHours(hours, minutes, 0, 0);
    // A bare "at 8am" that has already passed means tomorrow morning.
    if (toInstant(wall, timeZone).getTime() <= now.getTime()) wall.setUTCDate(wall.getUTCDate() + 1);
    return {
      at: toInstant(wall, timeZone),
      rest: text.replace(timeMatch[0], "").replace(/\b(tomorrow|today|next week)\b/, "").trim()
    };
  }

  if (dayOffset !== null) {
    wall.setUTCDate(wall.getUTCDate() + dayOffset);
    wall.setUTCHours(9, 0, 0, 0);
    return { at: toInstant(wall, timeZone), rest: text.replace(/\b(tomorrow|today|next week)\b/, "").trim() };
  }

  return null;
}

/** Formats an instant the way the person who asked for it would read it. */
export function formatInZone(date: Date, timeZone: string, options: Intl.DateTimeFormatOptions = {}) {
  return date.toLocaleString("en-US", {
    timeZone: timeZone || "UTC",
    dateStyle: "medium",
    timeStyle: "short",
    ...options
  });
}

export function formatDuration(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}
