import "server-only";
import { timingSafeEqual, createHash } from "node:crypto";
import { required } from "./config";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function requireOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(required("APP_URL")).origin)
    throw new HttpError(403, "Anfrage nicht erlaubt.");
}
export function checkSecret(value: string | null, expected: string) {
  if (!expected || expected.length < 32) return false;
  const a = Buffer.from(value ?? ""),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function assertRole(
  role: string | undefined,
  scope: "team" | "admin" | "parent",
) {
  if (!role) throw new HttpError(401, "Bitte melde dich an.");
  if (
    (scope === "admin" && role !== "admin") ||
    (scope === "team" && !["staff", "admin"].includes(role))
  )
    throw new HttpError(403, "Keine Berechtigung für diese Funktion.");
}
export function parentCancellation() {
  throw new HttpError(404, "Elternstornierungen sind im MVP nicht verfügbar.");
}
