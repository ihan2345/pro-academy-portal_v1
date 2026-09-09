import "server-only";
import { createHash } from "node:crypto";
import { serviceDb } from "./service-db";
import { renderReport, type ReportSnapshot } from "../pdf";
import { reportDueAt } from "../domain";
export async function materializeReport(id: string) {
  const db = serviceDb(),
    { data: row, error } = await db
      .from("report_snapshots")
      .select("*")
      .eq("id", id)
      .single();
  if (error) throw error;
  const { data: existing, error: fileError } = await db
    .from("report_files")
    .select("id")
    .eq("snapshot_id", id)
    .maybeSingle();
  if (fileError) throw fileError;
  if (existing) return;
  const bytes = await renderReport(row.snapshot as ReportSnapshot),
    path = `${row.player_id}/${row.period_id}/v${row.version}-${id}.pdf`;
  const digest = createHash("sha256").update(bytes).digest("hex");
  const { error: uploadError } = await db.storage
    .from("reports")
    .upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (uploadError) {
    const { data: download, error: downloadError } = await db.storage
      .from("reports")
      .download(path);
    if (downloadError || !download) throw uploadError;
    const existingDigest = createHash("sha256")
      .update(Buffer.from(await download.arrayBuffer()))
      .digest("hex");
    const result = await db.rpc("register_report_file", {
      snapshot: id,
      path,
      digest: existingDigest,
    });
    if (result.error) throw result.error;
    return;
  }
  const result = await db.rpc("register_report_file", {
    snapshot: id,
    path,
    digest,
  });
  if (result.error) throw result.error;
}
export async function processReports() {
  const db = serviceDb(),
    now = new Date(),
    { data: setting, error: se } = await db
      .from("system_settings")
      .select("value")
      .eq("key", "report_send_time")
      .maybeSingle();
  if (se) throw se;
  const sendTime = String(
    setting?.value ?? process.env.REPORT_SEND_TIME ?? "08:00",
  );
  const { data: periods, error } = await db
    .from("entitlement_periods")
    .select("id,ends_at,report_snapshots(id)")
    .lte("ends_at", now.toISOString())
    .neq("status", "void")
    .is("report_snapshots", null)
    .order("ends_at")
    .limit(1000);
  if (error) throw error;
  let count = 0;
  for (const period of periods ?? []) {
    if (new Date(reportDueAt(period.ends_at, sendTime)) > now) continue;
    if (!period.report_snapshots?.length) {
      const { data: id, error: captureError } = await db.rpc("capture_report", {
        period: period.id,
        contact_number: process.env.WHATSAPP_NUMBER ?? "",
      });
      if (captureError) throw captureError;
      await materializeReport(id);
      count++;
    }
  }
  const { data: pending, error: pendingError } = await db
    .from("report_snapshots")
    .select("id,report_files(id)")
    .is("report_files", null)
    .limit(1000);
  if (pendingError) throw pendingError;
  for (const row of pending ?? [])
    if (!row.report_files) await materializeReport(row.id);
  return count;
}
