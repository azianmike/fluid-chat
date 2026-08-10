export type TimeFormat = "12h" | "24h";

export function formatTime(value: string | Date, format: TimeFormat = "12h") {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: format === "12h"
  });
}

export function formatDayLabel(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (isSameDay(date, today)) return "Today";
  if (isSameDay(date, yesterday)) return "Yesterday";
  const sameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: sameYear ? undefined : "numeric"
  });
}

export function formatDateTime(value: string | Date, format: TimeFormat = "12h") {
  const date = value instanceof Date ? value : new Date(value);
  return `${formatDayLabel(date)} at ${formatTime(date, format)}`;
}

export function formatRelative(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

export { formatBytes } from "@/shared/format";

export function initialsFor(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

export function localTimeIn(timezone: string, format: TimeFormat = "12h") {
  try {
    return new Date().toLocaleTimeString(undefined, {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
      hour12: format === "12h"
    });
  } catch {
    return null;
  }
}

/** "9:41 AM" for today, "Mar 4" for older — used in sidebar and lists. */
export function compactTimestamp(value: string | Date, format: TimeFormat = "12h") {
  const date = value instanceof Date ? value : new Date(value);
  if (isSameDay(date, new Date())) return formatTime(date, format);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
