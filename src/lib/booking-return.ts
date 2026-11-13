// Only explicit internal booking routes survive authentication.
export function safeBookingReturn(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  return new RegExp(
    `^(?:/camp/buchung/${uuid}(?:\\?product=${uuid}(?:&channel=(?:catalog|homepage|parents|trials))?)?|/produkte\\?product=${uuid})$`,
    "i",
  ).test(value)
    ? value
    : null;
}
