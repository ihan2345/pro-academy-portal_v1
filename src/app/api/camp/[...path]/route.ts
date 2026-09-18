import { limitCampRequest } from "@/lib/camps/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireCampLocal,
  requireCampAccess,
  requireCampOrigin,
} from "@/lib/camps/guard";
import {
  campSession,
  publicCamp,
  discount,
  createBooking,
  confirmPayment,
  dashboard,
  saveCamp,
  invitationWish,
  reconcileCamp,
  removeCampMember,
  getCamp,
} from "@/lib/camps/service";
import { campReadiness } from "@/lib/camps/readiness";
import { campReview } from "@/lib/camps/local-review";
import { saveCampReview } from "@/lib/camps/import-review";
import { campAppOrigin } from "@/lib/camps/runtime";
import { benefitSchema } from "@/lib/camps/domain";
import { serviceDb, sessionDb } from "@/lib/server/supabase";
import { HttpError } from "@/lib/server/security";

const json = (v: unknown, status = 200) =>
  NextResponse.json(v, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
async function handler(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  try {
    await requireCampAccess();
    if (req.method !== "GET") requireCampOrigin(req);
    const path = (await ctx.params).path.join("/");
    if (req.method === "GET") {
      if (path === "review" || path === "local-review")
        return json(
          await campReview(z.uuid().parse(req.nextUrl.searchParams.get("id"))),
        );
      if (path === "readiness")
        return json(
          await campReadiness(
            z.uuid().parse(req.nextUrl.searchParams.get("id")),
          ),
        );
      if (path === "dashboard") return json(await dashboard());
      if (path.startsWith("public/"))
        return json(await publicCamp(z.uuid().parse(path.split("/")[1])));
      if (path === "discount")
        return json(
          await discount(
            z.uuid().parse(req.nextUrl.searchParams.get("camp_id")),
            z.uuid().parse(req.nextUrl.searchParams.get("player_id")),
          ),
        );
      if (path === "health") {
        await campSession(true);
        const r = await serviceDb()
          .from("camp_installation")
          .select("version")
          .maybeSingle();
        return json({
          database: !r.error && !!r.data,
          stripeTest: /^(sk|rk)_test_/.test(
            process.env.CAMP_STRIPE_SECRET_KEY ?? "",
          ),
          mail: false,
          jobs: false,
        });
      }
    }
    if (req.method === "POST") {
      if (["book", "confirm", "invitation-wish"].includes(path))
        await limitCampRequest(req, path);
      const raw = await req.text();
      if (raw.length > 32768) throw new HttpError(413, "Anfrage ist zu groß.");
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new HttpError(400, "Ungültige Anfrage.");
      }
      if (path === "remove-member") return json(await removeCampMember(body));
      if (path === "book") return json(await createBooking(body));
      if (path === "review-save")
        return json(await saveCampReview(body, false));
      if (path === "review-import")
        return json(await saveCampReview(body, true));
      if (path === "confirm")
        return json(
          await confirmPayment(
            z.object({ session_id: z.string() }).parse(body).session_id,
          ),
        );
      if (path === "invitation-wish")
        return json(
          await invitationWish(z.object({ id: z.uuid() }).parse(body).id),
        );
      if (path === "save") return json(await saveCamp(body, campAppOrigin()));
      if (path === "reconcile")
        return json(
          await reconcileCamp(z.object({ id: z.uuid() }).parse(body).id),
        );
      if (path === "benefit") {
        const s = await campSession(true);
        if (s.role !== "admin")
          throw new HttpError(403, "Tarifvorteile verwaltet der Admin.");
        const b = z
          .object({ id: z.uuid(), percent: benefitSchema })
          .parse(body);
        const r = await serviceDb()
          .from("plans")
          .update({ camp_benefit_percent: b.percent })
          .eq("id", b.id)
          .or("is_camp.is.null,is_camp.eq.false")
          .select("id")
          .single();
        if (r.error)
          throw new HttpError(
            400,
            "Tarifvorteil konnte nicht gespeichert werden.",
          );
        return json({ ok: true });
      }
      if (path === "status") {
        await campSession(true);
        const b = z
          .object({
            id: z.uuid(),
            status: z.enum(["draft", "open", "closed", "archived"]),
          })
          .parse(body);
        await getCamp(b.id);
        if (b.status === "open") {
          const r = await serviceDb()
            .from("camp_offers")
            .select("kind")
            .eq("camp_id", b.id);
          if (r.error || !r.data.some((o) => o.kind === "main"))
            throw new HttpError(400, "Normalangebot fehlt.");
        }
        const r = await serviceDb()
          .from("camps")
          .update({ status: b.status })
          .eq("id", b.id);
        if (r.error)
          throw new HttpError(400, "Status konnte nicht gespeichert werden.");
        return json({ ok: true });
      }
      if (path === "report") {
        await campSession(true);
        const b = z
          .object({
            booking_id: z.uuid(),
            content: z.string().trim().min(1).max(10000),
            visible_to_parent: z.boolean(),
          })
          .parse(body);
        const booking = await serviceDb()
          .from("camp_bookings")
          .select("camp_id,status")
          .eq("id", b.booking_id)
          .single();
        if (booking.error || booking.data.status !== "paid")
          throw new HttpError(
            400,
            "Berichte sind für bestätigte Teilnehmer verfügbar.",
          );
        await getCamp(booking.data.camp_id);
        const r = await serviceDb()
          .from("camp_reports")
          .upsert(
            { ...b, updated_at: new Date().toISOString() },
            { onConflict: "booking_id" },
          );
        if (r.error)
          throw new HttpError(400, "Bericht konnte nicht gespeichert werden.");
        return json({ ok: true });
      }
      if (path === "local-login") {
        await requireCampLocal();
        const { email } = z.object({ email: z.email() }).parse(body);
        const allowed = [
          process.env.EMAIL_TEST_RECIPIENT ?? "",
          ...(process.env.AUTH_TEST_EMAILS ?? "").split(","),
        ]
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean);
        if (!allowed.includes(email.toLowerCase()))
          throw new HttpError(
            403,
            "Nur konfigurierte Testkonten sind erlaubt.",
          );
        const db = serviceDb();
        let found = false;
        for (let page = 1; page <= 20; page++) {
          const r = await db.auth.admin.listUsers({ page, perPage: 100 });
          if (r.error) throw new HttpError(503, "Kontoprüfung fehlgeschlagen.");
          const user = r.data.users.find(
            (u) => u.email?.toLowerCase() === email.toLowerCase(),
          );
          if (user) {
            const p = await db
              .from("profiles")
              .select("id")
              .eq("id", user.id)
              .maybeSingle();
            found = !!p.data;
            break;
          }
          if (r.data.users.length < 100) break;
        }
        if (!found)
          throw new HttpError(
            400,
            "Vorhandenes freigegebenes Testkonto erforderlich. Es wird kein Konto angelegt.",
          );
        // generateLink returns a token without sending email. verifyOtp establishes a normal RLS session.
        const link = await db.auth.admin.generateLink({
          type: "magiclink",
          email,
        });
        if (link.error)
          throw new HttpError(
            503,
            "Lokaler Zugang konnte nicht erstellt werden.",
          );
        const auth = await sessionDb();
        const result = await auth.auth.verifyOtp({
          token_hash: link.data.properties.hashed_token,
          type: "magiclink",
        });
        if (result.error)
          throw new HttpError(
            503,
            "Lokaler Zugang konnte nicht bestätigt werden.",
          );
        return json({ ok: true });
      }
    }
    throw new HttpError(404, "Nicht gefunden.");
  } catch (e) {
    return json(
      {
        error:
          e instanceof z.ZodError
            ? e.issues.map((i) => i.message).join(" ")
            : e instanceof HttpError
              ? e.message
              : "Camp-Anfrage fehlgeschlagen.",
      },
      e instanceof HttpError ? e.status : e instanceof z.ZodError ? 400 : 500,
    );
  }
}
export { handler as GET, handler as POST };
