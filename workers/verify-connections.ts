import nodemailer from "nodemailer";
import { serviceDb } from "../src/lib/server/service-db";
import { stripeClient } from "../src/lib/server/stripe";
import { required } from "../src/lib/server/config";
import { renderReport } from "../src/lib/pdf";

// Connectivity-only check: no jobs claimed, messages sent or database rows written.
export async function verifyRunnerConnections() {
  const checks: Record<string, boolean> = {};
  const tasks = {
    supabase: async () => {
      const result = await serviceDb()
        .from("plans")
        .select("id", { head: true, count: "exact" });
      if (result.error) throw result.error;
    },
    stripe: async () => {
      await stripeClient().prices.list({ limit: 1 });
    },
    smtp: async () => {
      const transport = nodemailer.createTransport({
        host: required("PROTON_SMTP_HOST"),
        port: Number(process.env.PROTON_SMTP_PORT ?? 587),
        secure: false,
        requireTLS: true,
        auth: {
          user: required("PROTON_SMTP_USER"),
          pass: required("PROTON_SMTP_TOKEN"),
        },
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 25000,
        tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
      });
      try {
        await transport.verify();
      } finally {
        transport.close();
      }
    },
    pdf: async () => {
      const bytes = await renderReport({
        player_name: "Technische Vorschau",
        product_name: "NEXT LEVEL",
        starts_at: "2026-09-01T00:00:00Z",
        ends_at: "2026-10-01T00:00:00Z",
        included_units: 12,
        athletics_units: 4,
        completed: 0,
        minutes: 0,
        created_at: "2026-09-09T00:00:00Z",
        version: 1,
        whatsapp: "",
        events: [],
      });
      if (!Buffer.from(bytes).subarray(0, 5).equals(Buffer.from("%PDF-")))
        throw new Error("PDF rendering failed");
    },
  };
  await Promise.all(
    Object.entries(tasks).map(async ([name, task]) => {
      try {
        await task();
        checks[name] = true;
      } catch {
        checks[name] = false;
      }
    }),
  );
  return { ok: Object.values(checks).every(Boolean), checks };
}
