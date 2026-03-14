/** Return the current time as an ISO-8601 string (e.g. "2025-01-01T12:00:00.000Z"). */
export function nowISO(): string {
  return new Date().toISOString();
}

/** Return the current time in "YYYY-MM-DD HH:mm:ss" format (UTC). */
export function nowDatetime(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}
