import "server-only";
import { checkSecret, HttpError } from "../security";
import { serviceDb } from "../service-db";
import { requireProductShop } from "./runtime";
import { listProducts } from "./catalog";
import { required } from "../config";
export function showcaseCode(token: string | null) {
  if (!token) return null;
  const url = new URL(
    `/einbettung/produktbuehne/${token}`,
    required("APP_URL"),
  );
  return `<iframe src="${url.href}" title="ProAcademy Produktbühne" style="display:block;width:100%;height:100svh;border:0" loading="lazy" referrerpolicy="no-referrer"></iframe>`;
}
export async function requireShowcase(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new HttpError(404, "Einbettung nicht verfügbar.");
  await requireProductShop();
  const { data, error } = await serviceDb()
    .from("product_showcase_share")
    .select("token")
    .eq("singleton", true)
    .maybeSingle();
  if (error) throw new HttpError(503, "Einbettung derzeit nicht verfügbar.");
  if (!data?.token || !checkSecret(token, data.token))
    throw new HttpError(404, "Einbettung nicht mehr verfügbar.");
}
export async function showcaseProducts(token: string) {
  await requireShowcase(token);
  // Always use the public visitor context, even if a portal session exists.
  const page = await listProducts(
    null,
    new URLSearchParams({ channel: "catalog" }),
  );
  return { rows: page.rows };
}
