// Only these internal booking destinations may survive an authentication roundtrip.
export function safeBookingReturn(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^(?:\/camp\/buchung\/|\/produkte\?product=)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  )
    ? value
    : null;
}
