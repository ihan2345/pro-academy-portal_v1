import "server-only";
import { serviceDb } from "../service-db";
import { HttpError } from "../security";
export function productLiveMode() {
  return process.env.APP_MODE === "production";
}
export function productsEnabled() {
  if (process.env.PRODUCT_MANAGEMENT_ENABLED !== "true") return false;
  try {
    const app = new URL(process.env.APP_URL ?? "");
    const db = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    const local = (url: URL) =>
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    return productLiveMode()
      ? app.protocol === "https:" &&
          !local(app) &&
          db.protocol === "https:" &&
          !local(db)
      : process.env.APP_MODE === "test" && local(app) && local(db);
  } catch {
    return false;
  }
}
export function requireProducts() {
  if (!productsEnabled())
    throw new HttpError(
      404,
      "Produktverwaltung ist in dieser Umgebung nicht freigeschaltet.",
    );
}
export async function productShopEnabled() {
  if (!productsEnabled()) return false;
  try {
    const { data, error } = await serviceDb().rpc("product_shop_enabled");
    return !error && data === true;
  } catch {
    return false;
  }
}
export async function requireProductShop() {
  if (!(await productShopEnabled()))
    throw new HttpError(404, "Der Shop ist derzeit nicht verfügbar.");
}
export function requireProductPayments() {
  requireProducts();
  if (process.env.PRODUCT_PAYMENTS_ENABLED !== "true")
    throw new HttpError(503, "Produktzahlungen sind noch nicht eingerichtet.");
}
