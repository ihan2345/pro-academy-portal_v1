import { stripeActivities } from "@/lib/server/stripe-activities";
import { stripeParentInputs } from "@/lib/server/stripe-parent-inputs";
import { activityList, activitySummary } from "@/lib/server/activities";
import {
  subscriptionReviews,
  resolveSubscriptionReview,
} from "@/lib/server/subscription-reviews";
import { playerProfileList } from "@/lib/server/player-profiles";
import {
  profileList,
  loadParentProfile,
  editParentProfile,
  archiveProfileChild,
  changeProfileChild,
  profileChildSchema,
} from "@/lib/server/parent-profile";
import { readProfileFinances } from "@/lib/server/parent-profile-finances";
import { loadLogDetail } from "@/lib/server/log-detail";
import { campEnabled } from "@/lib/camps/runtime";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { sessionDb, sessionUser, serviceDb } from "@/lib/server/supabase";
import { required } from "@/lib/server/config";
import {
  HttpError,
  assertRole,
  requireOrigin,
  checkSecret,
  parentCancellation,
} from "@/lib/server/security";
import {
  trainingSchema,
  backfillSchema,
  attendanceSchema,
  cancelSchema,
  adminSchemas,
  importSchema,
} from "@/lib/server/schemas";
import {
  stripeClient,
  verifyStripe,
  persistStripeEvent,
  syncSubscription,
  syncInvoicePeriods,
} from "@/lib/server/stripe";
import {
  isV2Unavailable,
  V2_UNAVAILABLE,
  isBackfillExecutionDenied,
  BACKFILLS_LOCKED,
} from "@/lib/server/v2-availability";
import { readAll } from "@/lib/server/read-all";
import { renderReport } from "@/lib/pdf";
import {
  activeStripeCustomerIds,
  subscriptionPreviewLoader,
} from "@/lib/server/stripe-preview";
import {
  sameFamilyContact,
  selectBillingCustomer,
  subscriptionLinkIssue,
} from "@/lib/family-accounts";
import { releaseManualInvitation } from "@/lib/server/manual-invitation";
import { isAllowedTestLogin } from "@/lib/server/auth-test-access";
import {
  loadStampCard,
  stampCardRecipients,
  sendStampCard,
} from "@/lib/server/stamp-cards";
const json = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
const adminReads = new Set([
  "players",
  "parents",
  "parent_players",
  "staff_profiles",
  "plans",
  "subscriptions",
  "locations",
  "parent_invitations",
  "notification_jobs",
  "notification_deliveries",
  "report_snapshots",
  "report_files",
  "report_deliveries",
  "audit_log",
  "system_settings",
  "job_runs",
  "stripe_webhook_events",
]);
async function invite(parentId: string, actorId: string) {
  const result = await serviceDb().rpc("queue_parent_invitation", {
    input: {
      parent_id: parentId,
      actor_id: actorId,
    },
  });
  if (result.error) throw result.error;
  return result.data;
}
async function handler(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const path = (await context.params).path.join("/");
  try {
    if (
      process.env.CAMP_SIDE_EFFECTS_BLOCKED === "true" &&
      request.method !== "GET" &&
      path !== "auth/logout"
    )
      throw new HttpError(
        423,
        "Bestehende Portalprozesse sind im lokalen Camp-Test schreibgeschützt. Versand und Hintergrundverarbeitung bleiben gesperrt.",
      );
    if (path.startsWith("parent/cancel") || path === "parent-cancellation")
      parentCancellation();
    if (path === "stripe/webhook" && request.method === "POST") {
      const signature = request.headers.get("stripe-signature");
      if (!signature) throw new HttpError(400, "Stripe-Signatur fehlt.");
      let event;
      try {
        event = await verifyStripe(await request.text(), signature);
      } catch {
        throw new HttpError(400, "Stripe-Signatur ungültig.");
      }
      return json(await persistStripeEvent(event));
    }
    if (path === "cron" && request.method === "POST") {
      if (
        !checkSecret(
          request.headers.get("authorization")?.replace(/^Bearer /, "") ?? null,
          process.env.CRON_SECRET ?? "",
        )
      )
        throw new HttpError(401, "Nicht autorisiert.");
      const result = await fetch(`${required("JOB_RUNNER_URL")}/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${required("CRON_SECRET")}` },
        // Allow container cold start plus the runner's four-minute deadline.
        signal: AbortSignal.timeout(300000),
      });
      return json(await result.json(), result.status);
    }

    if (request.method !== "GET") requireOrigin(request);

    if (path === "auth/login" && request.method === "POST") {
      const { email, player_id } = z
        .object({ email: z.email(), player_id: z.uuid().optional() })
        .parse(await request.json());
      if (!isAllowedTestLogin(email))
        throw new HttpError(
          400,
          "Im Testbetrieb sind nur die freigegebenen Test-E-Mail-Adressen zugelassen.",
        );
      const store = await cookies(),
        hash = store.get("pa_invitation")?.value;
      let invitationValid = false;
      if (hash) {
        const { data, error } = await serviceDb()
          .from("parent_invitations")
          .select("id")
          .eq("token_hash", hash)
          .ilike("email", email)
          .is("consumed_at", null)
          .gt("expires_at", new Date().toISOString())
          .maybeSingle();
        if (error) throw error;
        invitationValid = !!data;
      }
      if (player_id)
        store.set("pa_player_redirect", player_id, {
          httpOnly: true,
          secure: new URL(required("APP_URL")).protocol === "https:",
          sameSite: "lax",
          path: "/",
          maxAge: 3600,
        });
      else store.delete("pa_player_redirect");
      const db = await sessionDb();
      await db.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: invitationValid,
          emailRedirectTo: `${required("APP_URL")}/auth/callback`,
        },
      });
      return json({ ok: true });
    }
    const session = await sessionUser();
    if (!session?.role) throw new HttpError(401, "Bitte melde dich an.");
    if (session.customerStatus === "trial" && path !== "auth/logout")
      throw new HttpError(403, "Bitte nutze dein Probetraining-Portal.");
    const { db, user, role } = session;
    if (path === "activities" || path === "activities/summary") {
      if (request.method !== "GET")
        throw new HttpError(405, "Aktivitäten sind ausschließlich lesbar.");
      if (path === "activities/summary")
        return json(await activitySummary(session));
      return json(
        await activityList(session, {
          window: request.nextUrl.searchParams.get("window") ?? "0",
          scope: request.nextUrl.searchParams.get("scope") ?? "all",
          limit: request.nextUrl.searchParams.has("limit")
            ? Number(request.nextUrl.searchParams.get("limit"))
            : 50,
          asOf: request.nextUrl.searchParams.get("asOf") ?? undefined,
          cursor: request.nextUrl.searchParams.get("cursor") ?? undefined,
        }),
      );
    }
    if (path === "admin/stripe-activities") {
      if (request.method !== "GET")
        throw new HttpError(
          405,
          "Stripe-Ereignisse sind hier ausschließlich lesbar.",
        );
      return json(
        await stripeActivities(session, {
          window: request.nextUrl.searchParams.get("window") ?? "all",
          limit: request.nextUrl.searchParams.has("limit")
            ? Number(request.nextUrl.searchParams.get("limit"))
            : 3,
          asOf:
            request.nextUrl.searchParams.get("asOf") ??
            new Date().toISOString(),
          cursor: request.nextUrl.searchParams.get("cursor") ?? undefined,
        }),
      );
    }
    if (path === "admin/stripe-parent-inputs") {
      if (request.method !== "GET")
        throw new HttpError(
          405,
          "Elternangaben sind hier ausschließlich lesbar.",
        );
      return json(
        await stripeParentInputs(session, {
          customer: request.nextUrl.searchParams.get("customer"),
          subscription:
            request.nextUrl.searchParams.get("subscription") ?? undefined,
        }),
      );
    }
    if (path === "admin/subscription-reviews") {
      if (request.method === "GET")
        return json(
          await subscriptionReviews(
            session,
            z.coerce
              .number()
              .int()
              .min(0)
              .max(100000)
              .parse(request.nextUrl.searchParams.get("offset") ?? 0),
          ),
        );
      if (request.method === "POST")
        return json(
          await resolveSubscriptionReview(session, await request.json()),
        );
    }
    if (path === "player-profiles" && request.method === "GET") {
      return json(
        await playerProfileList(session, {
          search: request.nextUrl.searchParams.get("search") ?? "",
          sort: request.nextUrl.searchParams.get("sort") ?? "name",
          cursor: request.nextUrl.searchParams.get("cursor") ?? undefined,
        }),
      );
    }
    if (path.startsWith("parent-profiles/")) {
      const parts = path.split("/");
      if (
        parts.length === 2 &&
        parts[1] === "list" &&
        request.method === "GET"
      ) {
        const offset = z.coerce
          .number()
          .int()
          .min(0)
          .max(100000)
          .parse(request.nextUrl.searchParams.get("offset") ?? 0);
        return json(
          await profileList(
            session,
            request.nextUrl.searchParams.get("search") ?? "",
            offset,
            z
              .enum(["true", "false"])
              .parse(
                request.nextUrl.searchParams.get("includeInactive") ?? "false",
              ) === "true",
            z
              .enum(["name", "months", "newest", "revenue"])
              .parse(request.nextUrl.searchParams.get("sort") ?? "name"),
          ),
        );
      }
      const target = z.uuid().parse(parts[1]);
      if (parts.length === 2 && request.method === "GET")
        return json(await loadParentProfile(session, target));
      if (
        parts.length === 3 &&
        parts[2] === "units" &&
        request.method === "GET"
      ) {
        const params = z
          .object({
            child: z.union([z.uuid(), z.literal("")]).default(""),
            period: z.enum(["month", "all"]).default("all"),
            state: z.enum(["planned", "past", "all"]).default("all"),
            day: z.union([z.iso.date(), z.literal("")]).default(""),
            offset: z.coerce.number().int().min(0).max(10000).default(0),
            limit: z.coerce.number().int().min(1).max(25).default(25),
          })
          .parse(Object.fromEntries(request.nextUrl.searchParams));
        const profile = await loadParentProfile(session, target, true);
        if (
          params.child &&
          !profile.children.some((c) => c.id === params.child)
        )
          throw new HttpError(404, "Kind nicht verfügbar.");
        const now = new Date().toISOString();
        const units = profile.units
          .filter(
            (u) =>
              (!params.child || u.player_id === params.child) &&
              (!params.day || u.day === params.day) &&
              (params.period !== "month" ||
                u.day?.startsWith(profile.month.slice(0, 7))) &&
              (params.state === "all" ||
                (params.state === "planned"
                  ? u.status === "planned" &&
                    !u.cancelled &&
                    !!u.starts_at &&
                    u.starts_at > now
                  : !u.starts_at || u.starts_at <= now)),
          )
          .sort(
            (a, b) =>
              (b.day ?? "").localeCompare(a.day ?? "") ||
              a.id.localeCompare(b.id),
          );
        return json({
          units: units.slice(params.offset, params.offset + params.limit),
          more: units.length > params.offset + params.limit,
        });
      }
      if (parts.length === 3 && request.method === "POST") {
        if (parts[2] === "unlink" || parts[2] === "child")
          return json(
            await changeProfileChild(
              session,
              target,
              parts[2],
              await request.json(),
            ),
          );
        if (parts[2] === "contact")
          return json(
            await editParentProfile(session, target, await request.json()),
          );
        if (parts[2] === "archive") {
          const input = z
            .object({ child_id: z.uuid() })
            .strict()
            .parse(await request.json());
          return json(
            await archiveProfileChild(session, target, input.child_id),
          );
        }
        if (parts[2] === "finances")
          return json(await readProfileFinances(session, target));
      }
      throw new HttpError(404, "Nicht gefunden.");
    }

    if (path === "activity" && request.method === "POST") {
      const { error } = await db.rpc("touch_user_activity");
      if (error) throw new HttpError(503, "Aktivitätsstatus nicht verfügbar.");
      return json({ ok: true });
    }
    if (path === "auth/logout" && request.method === "POST") {
      await db.auth.signOut();
      return json({ ok: true });
    }
    if (path === "stripe/portal" && request.method === "POST") {
      const body = await request.text();
      const input = z
        .object({ customer_id: z.string().startsWith("cus_").optional() })
        .parse(body ? JSON.parse(body) : {});
      const { data: accounts, error } = await db
        .from("parent_stripe_customers")
        .select("stripe_customer_id,parents!inner(auth_user_id,archived_at)")
        .eq("parents.auth_user_id", user.id)
        .is("parents.archived_at", null);
      if (error) throw error;
      if (!accounts?.length)
        throw new HttpError(404, "Noch kein Stripe-Kundenkonto zugeordnet.");
      const customer = selectBillingCustomer(
        accounts.map((a) => a.stripe_customer_id),
        input.customer_id,
      );
      if (!customer)
        throw new HttpError(
          400,
          "Bitte ein zugeordnetes Stripe-Kundenkonto auswählen.",
        );
      const result = await stripeClient().billingPortal.sessions.create({
        customer,
        return_url: `${required("APP_URL")}/konto`,
        configuration: required("STRIPE_PORTAL_CONFIGURATION_ID"),
      });
      return json({ url: result.url });
    }
    if (path.startsWith("reports/") && request.method === "GET") {
      const id = z.uuid().parse(path.split("/")[1]);
      if (role === "staff")
        throw new HttpError(403, "Keine Berechtigung für Berichte.");
      const { data: file, error } = await db
        .from("report_files")
        .select("storage_path")
        .eq("snapshot_id", id)
        .maybeSingle();
      if (error) throw error;
      if (!file) throw new HttpError(404, "Bericht nicht gefunden.");
      const { data: signed, error: signError } = await db.storage
        .from("reports")
        .createSignedUrl(file.storage_path, 60, { download: true });
      if (signError) throw signError;
      return NextResponse.redirect(signed.signedUrl, 303);
    }
    if (["team/stamp-card", "team/stamp-card-send"].includes(path)) {
      assertRole(role, "team");
      if (path === "team/stamp-card" && request.method === "GET") {
        const periodId = z
          .uuid()
          .parse(request.nextUrl.searchParams.get("period_id"));
        const card = await loadStampCard(db, role, periodId);
        if (request.nextUrl.searchParams.get("download") === "pdf") {
          const bytes = await renderReport(card.snapshot, "stamp_card");
          return new NextResponse(new Uint8Array(bytes), {
            headers: {
              "Content-Type": "application/pdf",
              "Content-Disposition": `attachment; filename="ProAcademy-Stempelkarte-${periodId}.pdf"`,
              "Cache-Control": "private, no-store",
            },
          });
        }
        return json({
          snapshot: card.snapshot,
          privateNotes: card.privateNotes,
          backfillsAvailable: card.backfillsAvailable,
          recipients: await stampCardRecipients(role, card.playerId),
          testRecipient:
            process.env.EMAIL_TEST_MODE !== "false"
              ? (process.env.EMAIL_TEST_RECIPIENT ?? "")
              : null,
        });
      }
      if (path === "team/stamp-card-send" && request.method === "POST") {
        const input = z
          .object({
            period_id: z.uuid(),
            parent_id: z.uuid().optional(),
            email: z.email().optional(),
            request_id: z.uuid(),
          })
          .strict()
          .parse(await request.json());
        const result = await sendStampCard(db, role, user.id, input);
        return json({
          ok: true,
          id: result.id,
          message: result.captured
            ? "Stempelkarte im Testbetrieb erfasst; keine E-Mail versendet."
            : "Stempelkarte per E-Mail versendet.",
        });
      }
      throw new HttpError(405, "Methode nicht erlaubt.");
    }
    if (path.startsWith("team/")) {
      assertRole(role, "team");
      if (request.method !== "POST")
        throw new HttpError(405, "Methode nicht erlaubt.");
      if (path === "team/validate-training-staff") {
        const { emails } = z
          .object({
            emails: z
              .array(z.string().trim().toLowerCase().pipe(z.email()))
              .min(1),
          })
          .strict()
          .parse(await request.json());
        const { data, error } = await db.rpc(
          "validate_training_staff_recipients",
          { emails },
        );
        if (error)
          throw new HttpError(
            400,
            error.code === "22023"
              ? error.message
              : "Team-Adressen konnten nicht geprüft werden.",
          );
        return json({ emails: data });
      }
      if (
        [
          "team/notification-options",
          "team/notify-parents",
          "team/confirm-all-attendance",
        ].includes(path)
      ) {
        const selection = z
          .object({
            parent_id: z.uuid(),
            player_id: z.uuid(),
            kind: z.enum(["planning", "training_reminder", "attendance"]),
          })
          .strict();
        const schema =
          path === "team/notify-parents"
            ? z
                .object({
                  id: z.uuid(),
                  selections: z.array(selection).max(1000),
                  staff_emails: z
                    .array(z.string().trim().toLowerCase().pipe(z.email()))
                    .optional(),
                })
                .strict()
                .refine(
                  (value) =>
                    value.selections.length > 0 || !!value.staff_emails?.length,
                  "Bitte mindestens einen Empfänger auswählen.",
                )
            : path === "team/confirm-all-attendance"
              ? z.object({ id: z.uuid(), confirmed: z.literal(true) }).strict()
              : z.object({ id: z.uuid() }).strict();
        const input = schema.parse(await request.json());
        const staffEmails =
          "staff_emails" in input && Array.isArray(input.staff_emails)
            ? input.staff_emails
            : [];
        const hasStaff = staffEmails.length > 0;
        const name =
          path === "team/notification-options"
            ? "training_notification_options"
            : path === "team/confirm-all-attendance"
              ? "confirm_planned_training_attendance"
              : hasStaff
                ? "submit_training_notifications_with_staff"
                : "submit_training_notifications";
        const { data, error } = await db.rpc(name, {
          event: input.id,
          ...("selections" in input ? { selections: input.selections } : {}),
          ...("confirmed" in input ? { confirmed: input.confirmed } : {}),
          ...(hasStaff ? { staff_emails: staffEmails } : {}),
        });
        if (error)
          throw new HttpError(
            400,
            hasStaff && error.code === "22023"
              ? error.message
              : "Aktion nicht möglich. Bitte Termin und Freigaben neu laden und erneut prüfen.",
          );
        return json({ ok: true, ...data });
      }
      let result;
      if (path === "team/backfills") {
        result = await db.rpc("save_training_backfill", {
          input: backfillSchema.parse(await request.json()),
          contact_number: process.env.WHATSAPP_NUMBER ?? "",
        });
      } else if (path === "team/events") {
        result = await db.rpc("save_training", {
          input: trainingSchema.parse(await request.json()),
        });
      } else if (path === "team/attendance") {
        const input = attendanceSchema.parse(await request.json());
        result = await db.rpc("set_attendance", {
          participant: input.participant,
          new_status: input.new_status,
          correction_reason: input.reason,
          send_correction: input.send_correction,
        });
      } else if (path === "team/cancel") {
        const input = cancelSchema.parse(await request.json());
        result = await db.rpc("cancel_training", {
          event: input.id,
          cancellation_reason: input.reason,
        });
      } else throw new HttpError(404, "Nicht gefunden.");
      if (result.error) {
        if (
          path === "team/backfills" &&
          isBackfillExecutionDenied(result.error)
        )
          throw new HttpError(503, BACKFILLS_LOCKED);
        if (isV2Unavailable(result.error))
          throw new HttpError(503, V2_UNAVAILABLE);
        throw new HttpError(400, result.error.message);
      }
      return json({ ok: true, id: result.data });
    }
    if (path.startsWith("admin/")) {
      assertRole(role, "admin");
      const action = path.slice(6);
      if (action === "log-detail" && request.method === "GET") {
        const detail = await loadLogDetail(
          role,
          request.nextUrl.searchParams.get("table") ?? "",
          request.nextUrl.searchParams.get("id") ?? "",
        );
        return new NextResponse(detail.text, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Content-Disposition": `inline; filename="${detail.filename}"`,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      if (action === "user-activity" && request.method === "POST") {
        const { ids } = z
          .object({ ids: z.array(z.uuid()).min(1).max(100) })
          .strict()
          .parse(await request.json());
        const { data: rows, error } = await db
          .from("user_activity")
          .select("user_id,last_seen_at")
          .in("user_id", ids);
        if (error)
          throw new HttpError(503, "Aktivitätsstatus nicht verfügbar.");
        return json({ rows, now: new Date().toISOString() });
      }
      if (action === "stripe-customers-sync" && request.method === "POST") {
        // Verify local schema before fetching Stripe or recording observations.
        const registry = await db
          .from("stripe_customer_registry")
          .select("id")
          .limit(1);
        if (registry.error) throw registry.error;
        const { after } = z
          .object({ after: z.string().startsWith("cus_").max(255).optional() })
          .parse(await request.json());
        const page = await stripeClient().customers.list({
          limit: 100,
          ...(after ? { starting_after: after } : {}),
        });
        if (page.has_more && !page.data.length)
          throw new HttpError(
            502,
            "Unvollständige Stripe-Antwort. Bitte erneut laden.",
          );
        const result = await serviceDb().rpc("observe_stripe_customers", {
          customers: page.data.map((c) => ({
            id: c.id,
            name: c.name,
            email: c.email,
          })),
        });
        if (result.error) throw result.error;
        return json({
          count: page.data.length,
          customers: page.data.map((c) => ({ id: c.id, created: c.created })),
          next_cursor: page.has_more ? page.data.at(-1)!.id : null,
        });
      }
      if (request.method === "GET") {
        if (action === "stripe-customers") {
          const [customers, links, activeCustomers] = await Promise.all([
            readAll(
              db,
              "stripe_customer_registry",
              "id,name,email,first_seen_at",
            ),
            readAll(db, "parent_stripe_customers", "id,stripe_customer_id"),
            activeStripeCustomerIds(stripeClient()),
          ]);
          const assigned = new Set(
            links.map((link) => link.stripe_customer_id),
          );
          return json({
            rows: customers.map((c) => ({
              ...c,
              assigned: assigned.has(c.id),
              has_active_subscription: activeCustomers.has(c.id),
            })),
          });
        }
        if (action === "stripe-customer-detail") {
          const id = z
            .string()
            .startsWith("cus_")
            .max(255)
            .parse(request.nextUrl.searchParams.get("id"));
          const stripe = stripeClient();
          const c = await stripe.customers.retrieve(id);
          if (c.deleted)
            throw new HttpError(404, "Dieser Stripe-Kunde wurde gelöscht.");
          const { data: parents, error } = await db
            .from("parents")
            .select("id,full_name,contact_email")
            .ilike("contact_email", c.email ?? "")
            .is("archived_at", null);
          if (error) throw error;
          const matches = (parents ?? []).filter((p) =>
            sameFamilyContact(p, c),
          );
          const campBookings = campEnabled()
            ? await serviceDb()
                .from("camp_bookings")
                .select("id,camp_id,status,paid_amount")
                .eq("stripe_customer_id", c.id)
                .order("created_at", { ascending: false })
                .limit(25)
            : { data: [], error: null };
          if (campBookings.error)
            throw new HttpError(
              503,
              "Camp-Zuordnung konnte nicht geprüft werden.",
            );
          return json({
            id: c.id,
            name: c.name,
            email: c.email,
            family_matches: matches,
            ambiguous: matches.length > 1,
            camp_bookings: campBookings.data,
            subscriptions: await subscriptionPreviewLoader(stripe)(c.id),
          });
        }
        const table = action === "einladungen" ? "parent_invitations" : action;
        if (!adminReads.has(table)) throw new HttpError(404, "Nicht gefunden.");
        const select =
          table === "parent_invitations"
            ? "id,parent_id,email,expires_at,consumed_at,created_at"
            : table === "notification_jobs"
              ? "id,kind,recipient,status,attempts,available_at,last_error,created_at,manual_email:payload->manual_email"
              : table === "stripe_webhook_events"
                ? "id,stripe_event_id,type,status,attempts,last_error,created_at"
                : table === "parents"
                  ? "*,parent_stripe_customers(stripe_customer_id),parent_players(id),parent_invitations(id,email)"
                  : table === "players"
                    ? "*,parent_players(id)"
                    : "*";
        const { data: rows, error } = await db
          .from(table)
          .select(select)
          .order("created_at", { ascending: false })
          .range(
            Number(request.nextUrl.searchParams.get("offset") ?? 0),
            Number(request.nextUrl.searchParams.get("offset") ?? 0) + 99,
          );
        if (error) throw error;
        if (table === "parents") {
          const parents = (rows ?? []) as unknown as Record<string, any>[];
          const invitations = parents.flatMap(
            (p) => p.parent_invitations ?? [],
          );
          const sent = new Set<string>();
          // Query by invitation ID, not just email: a changed contact must not inherit another invitation's status.
          for (let start = 0; start < invitations.length; start += 100) {
            const { data: jobs, error: sentError } = await db
              .from("notification_jobs")
              .select(
                "payload,recipient,notification_deliveries(recipient,provider,status)",
              )
              .eq("kind", "invitation")
              .eq("status", "sent")
              .in(
                "payload->>invitation_id",
                invitations.slice(start, start + 100).map((i) => i.id),
              );
            if (sentError) throw sentError;
            for (const job of jobs ?? [])
              if (
                job.notification_deliveries.some(
                  (delivery) =>
                    delivery.provider === "proton" &&
                    delivery.status === "sent" &&
                    delivery.recipient.toLowerCase() ===
                      String(job.recipient).toLowerCase(),
                ) &&
                String(job.recipient).toLowerCase() ===
                  String(
                    invitations.find((i) => i.id === job.payload.invitation_id)
                      ?.email,
                  ).toLowerCase()
              )
                sent.add(job.payload.invitation_id);
          }
          return json({
            rows: parents.map(({ parent_invitations, ...parent }) => ({
              ...parent,
              portal_status: parent.auth_user_id
                ? "registered"
                : parent_invitations?.some(
                      (i: { id: string; email: string }) =>
                        sent.has(i.id) &&
                        i.email.toLowerCase() ===
                          String(parent.contact_email).toLowerCase(),
                    )
                  ? "invited"
                  : "none",
            })),
          });
        }
        return json({ rows });
      }
      if (request.method === "POST") {
        if (action === "player-profile") {
          const { child_id, ...fields } = profileChildSchema.parse(
            await request.json(),
          );
          const result = await db
            .from("players")
            .update(fields)
            .eq("id", child_id)
            .select("id")
            .maybeSingle();
          if (result.error)
            throw new HttpError(
              400,
              "Kinderdaten konnten nicht gespeichert werden.",
            );
          if (!result.data) throw new HttpError(404, "Kind nicht verfügbar.");
          return json({ ok: true });
        }
        if (action === "training-api-link") {
          const { rotate } = z
            .object({ rotate: z.boolean().default(false) })
            .strict()
            .parse(await request.json());
          const result = await db.rpc("manage_training_api_share", {
            candidate: randomBytes(32).toString("hex"),
            rotate,
          });
          if (result.error || !/^[0-9a-f]{64}$/.test(result.data ?? ""))
            throw new HttpError(
              503,
              "Freigabelink konnte nicht bereitgestellt werden.",
            );
          return json({
            url: new URL(
              `/api/public/trainings/${result.data}`,
              required("APP_URL"),
            ).href,
          });
        }
        if (action === "roles") {
          const input = z
            .object({
              id: z.uuid(),
              role: z.enum(["parent", "staff", "admin"]),
            })
            .parse(await request.json());
          const result = await db.rpc("change_role", {
            target: input.id,
            new_role: input.role,
          });
          if (result.error) throw new HttpError(400, result.error.message);
          return json({ ok: true });
        }
        if (action === "notification-retry") {
          const input = z
            .object({
              id: z.uuid(),
              checked_not_delivered: z.literal(true),
              reason: z.string().min(5).max(500),
            })
            .parse(await request.json());
          const result = await db.rpc("retry_notification", {
            job: input.id,
            checked_not_delivered: input.checked_not_delivered,
            retry_reason: input.reason,
          });
          if (result.error) throw new HttpError(400, result.error.message);
          return json({ ok: true });
        }
        if (action === "parent-unlink") {
          const input = z
            .object({ id: z.uuid(), reason: z.string().min(5) })
            .parse(await request.json());
          const result = await db.rpc("unlink_parent_player", {
            link: input.id,
            unlink_reason: input.reason,
          });
          if (result.error) throw new HttpError(400, result.error.message);
          return json({ ok: true });
        }
        if (action === "invite") {
          const { parent_id } = z
            .object({ parent_id: z.uuid() })
            .parse(await request.json());
          return process.env.MANUAL_INVITATIONS_ENABLED === "true"
            ? json({
                id: await releaseManualInvitation(parent_id, user.id),
                status: "pending",
              })
            : json({ id: await invite(parent_id, user.id), status: "held" });
        }
        if (action === "stripe-link") {
          const input = importSchema.parse(await request.json()),
            subscription = await stripeClient().subscriptions.retrieve(
              input.subscription_id,
            );
          const issue = subscriptionLinkIssue(subscription, input);
          if (issue) throw new HttpError(400, issue);
          await syncSubscription(input.subscription_id);
          const { data: parent, error } = await serviceDb().rpc(
            "link_stripe_family",
            { input: { ...input, actor_id: user.id } },
          );
          if (error) throw new HttpError(400, error.message);
          await syncSubscription(input.subscription_id);
          for await (const invoice of stripeClient().invoices.list({
            subscription: input.subscription_id,
            status: "paid",
            limit: 100,
          }))
            if (invoice.id)
              await syncInvoicePeriods(invoice.id, input.subscription_id);
          return json({
            ok: true,
            parent_id: parent,
            invitation_status: "held",
          });
        }
        if (action === "report-resend") {
          const input = z
            .object({ id: z.uuid(), request_id: z.uuid() })
            .parse(await request.json());
          const result = await serviceDb().rpc("resend_report", {
            snapshot: input.id,
            request_id: input.request_id,
            actor: user.id,
          });
          if (result.error) throw new HttpError(400, result.error.message);
          return json({ ok: true });
        }
        if (action === "report-version") {
          const input = z
            .object({ period_id: z.uuid() })
            .parse(await request.json());
          const result = await serviceDb().rpc("capture_report", {
            period: input.period_id,
            force_version: true,
            contact_number: process.env.WHATSAPP_NUMBER ?? "",
          });
          if (result.error) throw new HttpError(400, result.error.message);
          return json({ ok: true, id: result.data });
        }
        if (adminSchemas[action]) {
          const input = adminSchemas[action].parse(
            await request.json(),
          ) as Record<string, unknown>;
          const result = await db
            .from(action)
            .upsert(input, {
              onConflict:
                action === "system_settings"
                  ? "key"
                  : action === "parent_players"
                    ? "parent_id,player_id"
                    : "id",
            })
            .select("id")
            .single();
          if (result.error) throw new HttpError(400, result.error.message);
          return json({ ok: true, id: result.data.id });
        }
      }
    }
    throw new HttpError(404, "Nicht gefunden.");
  } catch (error) {
    if (isV2Unavailable(error)) return json({ error: V2_UNAVAILABLE }, 503);
    if (error instanceof HttpError)
      return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError)
      return json({ error: error.issues.map((i) => i.message).join(" ") }, 400);
    console.error("Portal request failed", {
      path,
      message: error instanceof Error ? error.message : "unknown",
    });
    return json(
      {
        error:
          "Die Anfrage konnte nicht abgeschlossen werden. Bitte prüfe die Testkonfiguration oder versuche es später erneut.",
      },
      500,
    );
  }
}
export const GET = handler;
export const POST = handler;
