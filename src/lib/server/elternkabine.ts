import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { serviceDb } from "./service-db";
import { sessionUser } from "./supabase";
import { HttpError } from "./security";
import { portalParentId, NO_PARENT } from "./co-parent";
import { required } from "./config";
import { coParentMail } from "../elternkabine/mails";
import {
  type Access,
  AUTO_HIDE_REPORTS,
  CONSENT_VERSION,
  EDIT_WINDOW_MS,
  NAME_STYLES,
  POST_KINDS,
  QUESTION_ALERT_MS,
  REACTIONS,
  REPORT_REASONS,
  bodyProblem,
  coChangesLeft,
  inviteWaitHours,
  postAllowed,
  uAge,
} from "../elternkabine/rules";

type Session = NonNullable<Awaited<ReturnType<typeof sessionUser>>>;
const id = z.uuid();
const db = () => serviceDb();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ok(r: { data: unknown; error: unknown }): any {
  if (r.error) throw r.error;
  return r.data;
}

export async function elternkabineFlags() {
  const { data, error } = await db()
    .from("platform_features")
    .select("key,enabled")
    .in("key", ["elternkabine", "elternkabine_child_photos"]);
  if (error) return { enabled: false, childPhotos: false, installed: false };
  const on = (k: string) => !!data?.find((r) => r.key === k)?.enabled;
  return {
    enabled: on("elternkabine"),
    childPhotos: on("elternkabine_child_photos"),
    installed: true,
  };
}

async function session(): Promise<Session> {
  const s = await sessionUser();
  if (!s?.role) throw new HttpError(401, "Bitte melde dich an.");
  return s;
}
async function parentSession() {
  const s = await session();
  const flags = await elternkabineFlags();
  const team = s.role === "admin" || s.role === "staff";
  if (!flags.enabled && !team)
    throw new HttpError(404, "Die Elternkabine ist noch nicht freigeschaltet.");
  const parentId = s.role === "parent" ? await portalParentId(s.user.id) : null;
  if (s.role === "parent" && (!parentId || parentId === NO_PARENT))
    throw new HttpError(403, "Kein Elternkonto gefunden.");
  return { s, flags, team, parentId };
}
async function access(uid: string, channel: string): Promise<Access> {
  return ok(
    await db().rpc("community_access", { uid, ch: channel }),
  ) as unknown as Access;
}
async function names(uids: string[]) {
  const unique = [...new Set(uids)];
  if (!unique.length) return new Map<string, { name: string; team: boolean }>();
  const rows = ok(
    await db().rpc("community_names", { uids: unique }),
  ) as unknown as { user_id: string; name: string; team: boolean }[];
  return new Map(rows.map((r) => [r.user_id, { name: r.name, team: r.team }]));
}

// ───────────── Übersicht für Eltern (und Team) ─────────────
export async function overview() {
  const { s, flags, parentId } = await parentSession();
  const uid = s.user.id;
  const [family, member, regions, coRows] = await Promise.all([
    parentId
      ? db()
          .from("community_families")
          .select("*")
          .eq("parent_id", parentId)
          .maybeSingle()
          .then(ok)
      : null,
    db()
      .from("community_members")
      .select("name_style,muted_until,banned_at")
      .eq("user_id", uid)
      .maybeSingle()
      .then(ok),
    db()
      .from("locations")
      .select("id,name")
      .eq("is_region", true)
      .eq("active", true)
      .order("name")
      .then(ok),
    parentId && !s.coParent
      ? db()
          .from("parent_co_accounts")
          .select(
            "id,email,first_name,status,invite_sent_at,accepted_at,created_at,revoked_at",
          )
          .eq("parent_id", parentId)
          .order("created_at", { ascending: false })
          .then(ok)
      : [],
  ]);
  const { data: display } = await db().rpc("community_display_name", {
    uid,
  });
  const base = {
    flags,
    co_parent: !!s.coParent,
    role: s.role,
    family: family
      ? {
          enabled: family.enabled,
          consent_privacy: !!family.consent_privacy_at,
          consent_photos: !!family.consent_photos_at,
          consent_child_photos: !!family.consent_child_photos_at,
          region_id: family.region_id,
        }
      : null,
    me: {
      name_style: member?.name_style ?? "first_initial",
      display_name: (display as string) ?? "",
      banned: !!member?.banned_at,
    },
    regions: regions ?? [],
    children: parentId ? await familyChildren(parentId) : [],
    co: coAccountState(coRows ?? []),
  };
  const active =
    s.role !== "parent" ||
    (family?.enabled && family.consent_privacy_at && !member?.banned_at);
  if (!active) return { ...base, channels: [] };
  return {
    ...base,
    channels: await channelList(uid, parentId, base.children),
  };
}

function coAccountState(rows: any[]) {
  const open = rows.find((r) => r.status !== "revoked") ?? null;
  return {
    current: open
      ? {
          id: open.id,
          email: open.email,
          first_name: open.first_name,
          status: open.status,
          invite_sent_at: open.invite_sent_at,
          wait_hours: inviteWaitHours(open.invite_sent_at),
        }
      : null,
    changes_left: coChangesLeft(rows.map((r) => r.created_at)),
  };
}

type Child = Awaited<ReturnType<typeof familyChildren>>[number];
/** Kinder der Familie mit Altersklasse und aktuellen Abos (für Jahrgänge und „über Noah“). */
async function familyChildren(parentId: string) {
  const links = ok(
    await db()
      .from("parent_players")
      .select("players(id,first_name,birth_year,camp_birth_date,archived_at)")
      .eq("parent_id", parentId),
  ) as any[];
  const kids = links.map((l) => l.players).filter((p) => p && !p.archived_at);
  const periods = kids.length
    ? (ok(
        await db()
          .from("entitlement_periods")
          .select("player_id,product_name,ends_at")
          .in(
            "player_id",
            kids.map((k) => k.id),
          )
          .eq("status", "active")
          .gt("ends_at", new Date(Date.now() - 14 * 86400000).toISOString()),
      ) as any[])
    : [];
  return kids.map((k) => ({
    id: k.id as string,
    first_name: k.first_name as string,
    birth_year: (k.birth_year as number | null) ?? null,
    u: k.birth_year ? uAge(k.birth_year) : null,
    plans: [
      ...new Set(
        periods.filter((p) => p.player_id === k.id).map((p) => p.product_name),
      ),
    ] as string[],
  }));
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
function viaChildren(c: any, children: Child[]) {
  if (c.kind === "age")
    return children
      .filter((k) => k.u !== null && k.u >= c.u_from && k.u <= c.u_to)
      .map((k) => `${k.first_name} (U${k.u})`);
  if (c.kind === "plan")
    return children
      .filter((k) =>
        k.plans.some((p) => norm(p).includes(norm(c.plan_name ?? ""))),
      )
      .map((k) => k.first_name);
  return [];
}

/** Hauptkonto ergänzt ein fehlendes Geburtsdatum (speichert Geburtsjahr + Geburtstag im Kinderprofil). */
export async function saveChildBirth(input: unknown) {
  const s = await session();
  if (s.role !== "parent" || s.coParent)
    throw new HttpError(
      403,
      "Das Geburtsdatum kann nur das Hauptkonto eintragen.",
    );
  const parentId = await portalParentId(s.user.id);
  const body = z
    .object({ player_id: id, birth_date: z.iso.date() })
    .parse(input);
  const year = Number(body.birth_date.slice(0, 4));
  const now = new Date().getFullYear();
  if (year < now - 25 || year > now - 2)
    throw new HttpError(400, "Bitte prüfe das Geburtsdatum.");
  const link = ok(
    await db()
      .from("parent_players")
      .select("player_id,players(birth_year)")
      .eq("parent_id", parentId)
      .eq("player_id", body.player_id)
      .maybeSingle(),
  );
  if (!link) throw new HttpError(403, "Kind gehört nicht zu deinem Konto.");
  const known = link.players?.birth_year;
  if (known && known !== year)
    throw new HttpError(
      409,
      `Im Profil ist das Geburtsjahr ${known} gespeichert. Bitte ein Datum aus ${known} wählen oder das Team kontaktieren.`,
    );
  ok(
    await db()
      .from("players")
      .update({ birth_year: year, camp_birth_date: body.birth_date })
      .eq("id", body.player_id),
  );
  return { ok: true, u: uAge(year) };
}

async function channelList(
  uid: string,
  parentId: string | null,
  children: Child[] = [],
) {
  const rows = ok(
    await db().rpc("community_my_channels", { uid }),
  ) as unknown as { channel_id: string; access: Access }[];
  const visible = rows.filter((r) => r.access.level !== "none");
  if (!visible.length) return [];
  const ids = visible.map((r) => r.channel_id);
  const [channels, reads, posts] = await Promise.all([
    db()
      .from("community_channels")
      .select(
        "id,area,kind,title,emoji,description,write_mode,published_at,status,sort,plan_name,requires_consent,u_from,u_to",
      )
      .in("id", ids)
      .then(ok),
    db()
      .from("community_reads")
      .select("channel_id,last_read_at,muted")
      .eq("user_id", uid)
      .then(ok),
    db()
      .from("community_posts")
      .select(
        "id,channel_id,author_id,author_parent_id,body,created_at,reply_to,kind",
      )
      .in("channel_id", ids)
      .is("deleted_at", null)
      .is("hidden_at", null)
      .order("created_at", { ascending: false })
      .limit(2000)
      .then(ok),
  ]);
  const channelKind = new Map(
    (channels ?? []).map((c: any) => [c.id, c.kind as string]),
  );
  const mine = (p: any) =>
    channelKind.get(p.channel_id) !== "ask_team" ||
    !parentId ||
    p.author_parent_id === parentId ||
    isReplyToFamily(p, posts ?? [], parentId);
  const visiblePosts = (posts ?? []).filter(mine);
  const authorNames = await names(
    visiblePosts.slice(0, 200).map((p: any) => p.author_id),
  );
  return (channels ?? [])
    .map((c: any) => {
      const a = visible.find((v) => v.channel_id === c.id)!.access;
      const read = (reads ?? []).find((r: any) => r.channel_id === c.id);
      const list = visiblePosts.filter((p: any) => p.channel_id === c.id);
      const last = list[0];
      return {
        ...c,
        access: a,
        via: viaChildren(c, children),
        muted: !!read?.muted,
        unread: list.filter(
          (p: any) =>
            p.author_id !== uid && (!read || p.created_at > read.last_read_at),
        ).length,
        last: last
          ? {
              body: String(last.body).slice(0, 90),
              at: last.created_at,
              name: authorNames.get(last.author_id)?.name ?? "",
            }
          : null,
      };
    })
    .sort(
      (a: any, b: any) => a.sort - b.sort || a.title.localeCompare(b.title),
    );
}
function isReplyToFamily(p: any, all: any[], parentId: string) {
  if (!p.reply_to) return false;
  const root = all.find((r) => r.id === p.reply_to);
  return root?.author_parent_id === parentId;
}

// ───────────── Kanal lesen ─────────────
export async function channelPosts(channelId: string) {
  const { s, parentId } = await parentSession();
  const ch = id.parse(channelId);
  const a = await access(s.user.id, ch);
  if (a.level === "none")
    throw new HttpError(404, "Diesen Kanal gibt es für dich nicht.");
  const channel = ok(
    await db().from("community_channels").select("*").eq("id", ch).single(),
  );
  if (a.level === "locked")
    return { channel, access: a, posts: [], members: 0 };
  const team = !!a.team;
  let q = db()
    .from("community_posts")
    .select(
      "id,author_id,author_parent_id,author_team,reply_to,kind,body,mentions,pinned,solved_by,hidden_at,hidden_reason,edited_at,deleted_at,created_at",
    )
    .eq("channel_id", ch)
    .order("created_at", { ascending: true })
    .limit(500);
  if (!team) q = q.is("hidden_at", null);
  let posts = ok(await q) as any[];
  if (channel.kind === "ask_team" && !team)
    posts = posts.filter(
      (p) =>
        p.author_parent_id === parentId || isReplyToFamily(p, posts, parentId!),
    );
  const ids = posts.map((p) => p.id);
  const reactions = ids.length
    ? (ok(
        await db()
          .from("community_reactions")
          .select("post_id,user_id,emoji")
          .in("post_id", ids),
      ) as any[])
    : [];
  const n = await names([
    ...posts.map((p) => p.author_id),
    ...posts.flatMap((p) => p.mentions ?? []),
  ]);
  const counts = (ok(await db().rpc("community_member_counts")) ??
    []) as unknown as { channel_id: string; members: number }[];
  await db().from("community_reads").upsert(
    {
      user_id: s.user.id,
      channel_id: ch,
      last_read_at: new Date().toISOString(),
    },
    { onConflict: "user_id,channel_id" },
  );
  return {
    channel,
    access: a,
    members: counts.find((c) => c.channel_id === ch)?.members ?? 0,
    me: s.user.id,
    posts: posts.map((p) => ({
      ...p,
      body: p.deleted_at ? "" : p.body,
      author: n.get(p.author_id)?.name ?? "Elternteil",
      team: p.author_team,
      mine: p.author_id === s.user.id,
      editable:
        p.author_id === s.user.id &&
        !p.deleted_at &&
        Date.now() - Date.parse(p.created_at) < EDIT_WINDOW_MS,
      mention_names: (p.mentions ?? []).map(
        (m: string) => n.get(m)?.name ?? "",
      ),
      reactions: summarize(
        reactions.filter((r) => r.post_id === p.id),
        s.user.id,
      ),
    })),
    mention_candidates: [...n.entries()]
      .filter(([uid]) => uid !== s.user.id)
      .map(([uid, v]) => ({ id: uid, name: v.name, team: v.team })),
  };
}
function summarize(rows: any[], me: string) {
  return REACTIONS.map((emoji) => ({
    emoji,
    count: rows.filter((r) => r.emoji === emoji).length,
    mine: rows.some((r) => r.emoji === emoji && r.user_id === me),
  })).filter((r) => r.count > 0);
}

// ───────────── Schreiben ─────────────
const postSchema = z.object({
  channel_id: id,
  body: z.string().trim().min(1).max(4000),
  kind: z.enum(POST_KINDS as [string, ...string[]]).default("text"),
  reply_to: id.nullable().optional(),
  mentions: z.array(id).max(10).default([]),
});
export async function createPost(input: unknown) {
  const { s, parentId } = await parentSession();
  const body = postSchema.parse(input);
  const a = await access(s.user.id, body.channel_id);
  const channel = ok(
    await db()
      .from("community_channels")
      .select("id,kind,published_at,status")
      .eq("id", body.channel_id)
      .single(),
  );
  let root: any = null;
  if (body.reply_to) {
    root = ok(
      await db()
        .from("community_posts")
        .select("id,channel_id,reply_to,author_parent_id,deleted_at")
        .eq("id", body.reply_to)
        .single(),
    );
    if (root.channel_id !== body.channel_id || root.deleted_at)
      throw new HttpError(
        400,
        "Auf diesen Beitrag kann nicht geantwortet werden.",
      );
    if (root.reply_to) root = { ...root, id: root.reply_to };
  }
  const problem = postAllowed({
    access: a,
    kind: body.kind as any,
    isReply: !!root,
    channelKind: channel.kind,
    ownThread: !!root && root.author_parent_id === parentId,
  });
  if (problem) throw new HttpError(403, problem);
  if (!a.team) {
    const filter = bodyProblem(body.body);
    if (filter) throw new HttpError(400, filter);
    const member = ok(
      await db()
        .from("community_members")
        .select("muted_until")
        .eq("user_id", s.user.id)
        .maybeSingle(),
    );
    if (member?.muted_until && Date.parse(member.muted_until) > Date.now())
      throw new HttpError(
        403,
        "Du bist vorübergehend stummgeschaltet. Lesen geht weiterhin.",
      );
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { count } = await db()
      .from("community_posts")
      .select("id", { count: "exact", head: true })
      .eq("author_id", s.user.id)
      .gt("created_at", since);
    if ((count ?? 0) >= 10)
      throw new HttpError(
        429,
        "Kurz durchatmen: Bitte warte ein paar Minuten.",
      );
  }
  const inserted = ok(
    await db()
      .from("community_posts")
      .insert({
        channel_id: body.channel_id,
        author_id: s.user.id,
        author_parent_id: a.team ? null : parentId,
        author_team: !!a.team,
        reply_to: root?.id ?? null,
        kind: root ? "text" : body.kind,
        body: body.body,
        mentions: body.mentions,
        pinned: !!a.team && body.kind === "info" && !root,
      })
      .select("id")
      .single(),
  );
  // Erste Nachricht eines Admins/Teams veröffentlicht den Kanal.
  if (a.team && !channel.published_at)
    await db()
      .from("community_channels")
      .update({ published_at: new Date().toISOString() })
      .eq("id", body.channel_id);
  return { id: inserted.id, published: a.team && !channel.published_at };
}

async function ownPost(uid: string, postId: string) {
  const p = ok(
    await db()
      .from("community_posts")
      .select("id,author_id,created_at,deleted_at,channel_id")
      .eq("id", id.parse(postId))
      .single(),
  );
  if (p.author_id !== uid || p.deleted_at)
    throw new HttpError(403, "Das ist nicht dein Beitrag.");
  return p;
}
export async function editPost(input: unknown) {
  const { s, team } = await parentSession();
  const body = z
    .object({ id, body: z.string().trim().min(1).max(4000) })
    .parse(input);
  const p = await ownPost(s.user.id, body.id);
  if (Date.now() - Date.parse(p.created_at) > EDIT_WINDOW_MS)
    throw new HttpError(403, "Bearbeiten geht nur 15 Minuten lang.");
  if (!team) {
    const filter = bodyProblem(body.body);
    if (filter) throw new HttpError(400, filter);
  }
  ok(
    await db()
      .from("community_posts")
      .update({ body: body.body, edited_at: new Date().toISOString() })
      .eq("id", p.id),
  );
  return { ok: true };
}
export async function deletePost(input: unknown) {
  const { s } = await parentSession();
  const p = await ownPost(s.user.id, z.object({ id }).parse(input).id);
  ok(
    await db()
      .from("community_posts")
      .update({ deleted_at: new Date().toISOString(), body: "–", mentions: [] })
      .eq("id", p.id),
  );
  return { ok: true };
}
export async function react(input: unknown) {
  const { s } = await parentSession();
  const body = z.object({ post_id: id, emoji: z.enum(REACTIONS) }).parse(input);
  const post = ok(
    await db()
      .from("community_posts")
      .select("channel_id")
      .eq("id", body.post_id)
      .single(),
  );
  const a = await access(s.user.id, post.channel_id);
  if (!["write", "ask", "read"].includes(a.level) || (a.grace_until && !a.team))
    throw new HttpError(403, "Reagieren ist hier nicht möglich.");
  const existing = ok(
    await db()
      .from("community_reactions")
      .select("post_id")
      .eq("post_id", body.post_id)
      .eq("user_id", s.user.id)
      .eq("emoji", body.emoji)
      .maybeSingle(),
  );
  if (existing)
    ok(
      await db()
        .from("community_reactions")
        .delete()
        .eq("post_id", body.post_id)
        .eq("user_id", s.user.id)
        .eq("emoji", body.emoji),
    );
  else
    ok(
      await db().from("community_reactions").insert({
        post_id: body.post_id,
        user_id: s.user.id,
        emoji: body.emoji,
      }),
    );
  return { ok: true };
}
export async function report(input: unknown) {
  const { s } = await parentSession();
  const body = z
    .object({
      post_id: id,
      reason: z.enum(REPORT_REASONS),
      note: z.string().trim().max(500).default(""),
    })
    .parse(input);
  const post = ok(
    await db()
      .from("community_posts")
      .select("channel_id,author_id")
      .eq("id", body.post_id)
      .single(),
  );
  if ((await access(s.user.id, post.channel_id)).level === "none")
    throw new HttpError(404, "Beitrag nicht gefunden.");
  if (post.author_id === s.user.id)
    throw new HttpError(400, "Eigene Beiträge kannst du löschen statt melden.");
  const r = await db()
    .from("community_reports")
    .insert({ reporter_id: s.user.id, ...body });
  if (r.error && !String(r.error.message).includes("duplicate")) throw r.error;
  const { count } = await db()
    .from("community_reports")
    .select("id", { count: "exact", head: true })
    .eq("post_id", body.post_id)
    .eq("state", "open");
  if ((count ?? 0) >= AUTO_HIDE_REPORTS)
    await db()
      .from("community_posts")
      .update({
        hidden_at: new Date().toISOString(),
        hidden_reason: "auto_reports",
      })
      .eq("id", body.post_id)
      .is("hidden_at", null);
  return { ok: true };
}
export async function setMuted(input: unknown) {
  const { s } = await parentSession();
  const body = z.object({ channel_id: id, muted: z.boolean() }).parse(input);
  ok(
    await db()
      .from("community_reads")
      .upsert(
        { user_id: s.user.id, channel_id: body.channel_id, muted: body.muted },
        { onConflict: "user_id,channel_id" },
      ),
  );
  return { ok: true };
}

// ───────────── Einstellungen ─────────────
export async function saveMe(input: unknown) {
  const { s } = await parentSession();
  const body = z.object({ name_style: z.enum(NAME_STYLES) }).parse(input);
  ok(
    await db().from("community_members").upsert(
      {
        user_id: s.user.id,
        name_style: body.name_style,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    ),
  );
  return { ok: true };
}
const familySchema = z.object({
  enabled: z.boolean(),
  consent_privacy: z.boolean(),
  consent_photos: z.boolean().default(false),
  consent_child_photos: z.boolean().default(false),
  region_id: id.nullable().default(null),
});
export async function saveFamily(input: unknown) {
  const { s, flags, parentId } = await parentSession();
  if (s.role !== "parent" || !parentId)
    throw new HttpError(403, "Nur für Eltern.");
  if (s.coParent)
    throw new HttpError(
      403,
      "Die Einstellungen der Elternkabine kann nur das Hauptkonto ändern.",
    );
  const body = familySchema.parse(input);
  if (body.enabled && !body.consent_privacy)
    throw new HttpError(
      400,
      "Bitte stimme dem Datenschutz und den Regeln zu, um beizutreten.",
    );
  if (body.region_id) {
    const region = ok(
      await db()
        .from("locations")
        .select("id")
        .eq("id", body.region_id)
        .eq("is_region", true)
        .maybeSingle(),
    );
    if (!region) throw new HttpError(400, "Diese Region gibt es nicht.");
  }
  const previous = ok(
    await db()
      .from("community_families")
      .select("*")
      .eq("parent_id", parentId)
      .maybeSingle(),
  );
  const keep = (wanted: boolean, before?: string | null) =>
    wanted ? (before ?? new Date().toISOString()) : null;
  ok(
    await db()
      .from("community_families")
      .upsert(
        {
          parent_id: parentId,
          enabled: body.enabled,
          consent_privacy_at: keep(
            body.consent_privacy,
            previous?.consent_privacy_at,
          ),
          consent_photos_at: keep(
            body.consent_photos,
            previous?.consent_photos_at,
          ),
          consent_child_photos_at: flags.childPhotos
            ? keep(body.consent_child_photos, previous?.consent_child_photos_at)
            : null,
          consent_version: body.consent_privacy ? CONSENT_VERSION : null,
          region_id: body.region_id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "parent_id" },
      ),
  );
  return { ok: true };
}

// ───────────── Zweiter Elternteil ─────────────
async function mainParent() {
  const s = await session();
  if (s.role !== "parent" || s.coParent)
    throw new HttpError(403, "Das kann nur das Hauptkonto.");
  const parentId = await portalParentId(s.user.id);
  const parent = ok(
    await db()
      .from("parents")
      .select("id,full_name,contact_email")
      .eq("id", parentId)
      .single(),
  );
  return { s, parent };
}
const inviteSchema = z.object({
  email: z.email().trim().toLowerCase(),
  first_name: z.string().trim().min(1).max(60),
});
async function checkCoEmail(email: string, s: Session, parentId: string) {
  if (email === (s.user.email ?? "").toLowerCase())
    throw new HttpError(400, "Das ist deine eigene E-Mail-Adresse.");
  const taken = ok(
    await db()
      .from("parents")
      .select("id")
      .ilike("contact_email", email)
      .is("archived_at", null)
      .limit(1),
  ) as any[];
  if (taken.length)
    throw new HttpError(
      409,
      "Diese E-Mail gehört schon zu einem eigenen Elternkonto und kann nicht als Zweitkonto verbunden werden.",
    );
  const other = ok(
    await db()
      .from("parent_co_accounts")
      .select("parent_id")
      .eq("email", email)
      .in("status", ["invited", "active"]),
  ) as any[];
  if (other.some((o) => o.parent_id !== parentId))
    throw new HttpError(
      409,
      "Diese E-Mail ist schon mit einer anderen Familie verbunden.",
    );
}
export async function coInvitePreview(input: unknown) {
  const { s, parent } = await mainParent();
  const body = inviteSchema.parse(input);
  await checkCoEmail(body.email, s, parent.id);
  const m = coParentMail(
    "co_parent_invitation",
    { first_name: body.first_name, main_name: parent.full_name },
    required("APP_URL"),
  );
  return { to: body.email, subject: m.subject, text: m.text };
}
async function queueCoMail(
  kind: string,
  row: any,
  mainName: string,
  reason = "",
) {
  ok(
    await db()
      .from("notification_jobs")
      .insert({
        idempotency_key: `${kind}:${row.id}:${Date.now()}`,
        kind,
        recipient: row.email,
        payload: { first_name: row.first_name, main_name: mainName, reason },
      }),
  );
}
export async function coInvite(input: unknown) {
  const { s, parent } = await mainParent();
  const body = inviteSchema.parse(input);
  await checkCoEmail(body.email, s, parent.id);
  const rows = ok(
    await db()
      .from("parent_co_accounts")
      .select("id,email,status,created_at,invite_sent_at")
      .eq("parent_id", parent.id),
  ) as any[];
  const open = rows.find((r) => r.status !== "revoked");
  if (open && open.email !== body.email)
    throw new HttpError(
      409,
      "Es ist schon ein zweiter Elternteil verbunden. Bitte entferne ihn zuerst.",
    );
  let row = open;
  if (!row) {
    if (coChangesLeft(rows.map((r) => r.created_at)) <= 0)
      throw new HttpError(
        429,
        "Das Zweitkonto kann höchstens zweimal pro Monat geändert werden. Ab dem nächsten Monat geht es wieder.",
      );
    row = ok(
      await db()
        .from("parent_co_accounts")
        .insert({
          parent_id: parent.id,
          email: body.email,
          first_name: body.first_name,
          created_by: s.user.id,
        })
        .select("*")
        .single(),
    );
  }
  if (row.status === "active")
    throw new HttpError(409, "Dieser Elternteil ist schon verbunden.");
  const wait = inviteWaitHours(row.invite_sent_at);
  if (wait)
    throw new HttpError(
      429,
      `Einladungen gehen höchstens einmal pro Tag raus. Nächster Versand in ${wait} Std. möglich.`,
    );
  await queueCoMail(
    "co_parent_invitation",
    { ...row, first_name: body.first_name },
    parent.full_name,
  );
  ok(
    await db()
      .from("parent_co_accounts")
      .update({
        first_name: body.first_name,
        invite_sent_at: new Date().toISOString(),
        invite_count: (row.invite_count ?? 0) + 1,
      })
      .eq("id", row.id),
  );
  return { ok: true };
}
async function coGifts(authUserId: string | null) {
  if (!authUserId) return 0;
  const { count } = await db()
    .from("gift_account_links")
    .select("order_id", { count: "exact", head: true })
    .eq("auth_id", authUserId);
  return count ?? 0;
}
export async function coRemoveCheck() {
  const { parent } = await mainParent();
  const row = ok(
    await db()
      .from("parent_co_accounts")
      .select("id,auth_user_id")
      .eq("parent_id", parent.id)
      .in("status", ["invited", "active"])
      .maybeSingle(),
  );
  return { gift_cards: await coGifts(row?.auth_user_id ?? null) };
}
export async function coRemove(input: unknown) {
  const { parent } = await mainParent();
  const body = z
    .object({ confirm_gifts: z.boolean().default(false) })
    .parse(input);
  const row = ok(
    await db()
      .from("parent_co_accounts")
      .select("*")
      .eq("parent_id", parent.id)
      .in("status", ["invited", "active"])
      .maybeSingle(),
  );
  if (!row) throw new HttpError(404, "Kein zweiter Elternteil verbunden.");
  const gifts = await coGifts(row.auth_user_id);
  if (gifts && !body.confirm_gifts)
    throw new HttpError(
      409,
      `Achtung: Mit diesem Zweitkonto sind ${gifts} Geschenkkarte(n) verbunden. Bitte bestätige das Entfernen.`,
    );
  ok(
    await db()
      .from("parent_co_accounts")
      .update({
        status: "revoked",
        revoked_at: new Date().toISOString(),
        revoked_reason: "main_removed",
      })
      .eq("id", row.id),
  );
  if (row.status === "active")
    await queueCoMail(
      "co_parent_removed",
      row,
      parent.full_name,
      "main_removed",
    );
  return { ok: true };
}

// ───────────── Admin (Super-Admin + Passwort) ─────────────
const ADMIN_COOKIE = "pa_elternkabine";
function adminToken(uid: string) {
  return createHash("sha256")
    .update(`${uid}:${required("ELTERNKABINE_ADMIN_PASSWORD")}`)
    .digest("hex");
}
async function superAdmin() {
  const s = await session();
  if (s.role !== "admin") throw new HttpError(403, "Keine Berechtigung.");
  const { data, error } = await s.db.rpc("can_manage_features");
  if (error || data !== true) throw new HttpError(403, "Nur für Super-Admins.");
  return s;
}
export async function adminUnlocked() {
  const s = await superAdmin().catch(() => null);
  if (!s || !process.env.ELTERNKABINE_ADMIN_PASSWORD) return false;
  const value = (await cookies()).get(ADMIN_COOKIE)?.value ?? "";
  const want = adminToken(s.user.id);
  return (
    value.length === want.length &&
    timingSafeEqual(Buffer.from(value), Buffer.from(want))
  );
}
export async function adminUnlock(input: unknown) {
  const s = await superAdmin();
  const { password } = z
    .object({ password: z.string().min(1).max(200) })
    .parse(input);
  const want = Buffer.from(required("ELTERNKABINE_ADMIN_PASSWORD"));
  const got = Buffer.from(password);
  if (got.length !== want.length || !timingSafeEqual(got, want))
    throw new HttpError(403, "Passwort falsch.");
  (await cookies()).set(ADMIN_COOKIE, adminToken(s.user.id), {
    httpOnly: true,
    secure: new URL(required("APP_URL")).protocol === "https:",
    sameSite: "strict",
    path: "/",
    maxAge: 12 * 3600,
  });
  return { ok: true };
}
async function requireAdmin() {
  if (!(await adminUnlocked()))
    throw new HttpError(
      403,
      "Bitte zuerst mit dem Elternkabine-Passwort entsperren.",
    );
  return superAdmin();
}

/** Smarte Hinweise für die Glocke (für alle Admins sichtbar, sobald installiert). */
export async function adminAlerts() {
  const s = await session();
  if (s.role !== "admin" && s.role !== "staff") return { alerts: [] };
  const flags = await elternkabineFlags();
  if (!flags.installed) return { alerts: [] };
  const [questions, reports, drafts, replies] = await Promise.all([
    db()
      .from("community_posts")
      .select(
        "id,channel_id,body,created_at,author_id,community_channels(title)",
      )
      .eq("kind", "question")
      .is("reply_to", null)
      .is("deleted_at", null)
      .is("hidden_at", null)
      .is("solved_by", null)
      .lt("created_at", new Date(Date.now() - QUESTION_ALERT_MS).toISOString())
      .order("created_at")
      .limit(30)
      .then(ok),
    db()
      .from("community_reports")
      .select(
        "id,reason,note,created_at,post_id,community_posts(body,channel_id,hidden_at)",
      )
      .eq("state", "open")
      .order("created_at")
      .limit(30)
      .then(ok),
    db()
      .from("community_channels")
      .select("id,title,emoji,kind")
      .is("published_at", null)
      .eq("status", "active")
      .then(ok),
    db()
      .from("community_posts")
      .select("reply_to")
      .eq("author_team", true)
      .not("reply_to", "is", null)
      .then(ok),
  ]);
  const answered = new Set((replies ?? []).map((r: any) => r.reply_to));
  const n = await names((questions ?? []).map((q: any) => q.author_id));
  const alerts = [
    ...reportGroups(reports ?? []).map(({ r, count, reasons }) => ({
      key: `ek-report:${r.post_id}`,
      type: "report",
      tone: "red",
      title:
        count > 1
          ? `${count} Meldungen zu einem Beitrag`
          : "Meldung in der Elternkabine",
      text: `„${String(r.community_posts?.body ?? "").slice(0, 120)}“${reasons ? ` · ${reasons}` : ""}`,
      suggestion: r.community_posts?.hidden_at
        ? "Automatisch ausgeblendet (3 Meldungen). Prüfen und entscheiden."
        : "Beitrag prüfen: ausblenden oder Meldung schließen.",
      at: r.created_at,
      href: `/admin-elternkabine?kanal=${r.community_posts?.channel_id}&beitrag=${r.post_id}`,
      // Ohne report_id: die Aktion gilt für alle offenen Meldungen des Beitrags.
      actions: [
        { id: "hide", label: "Ausblenden", post_id: r.post_id },
        { id: "dismiss", label: "Ist okay", post_id: r.post_id },
      ],
    })),
    ...(questions ?? [])
      .filter((q: any) => !answered.has(q.id))
      .map((q: any) => ({
        key: `ek-question:${q.id}`,
        type: "question",
        tone: "amber",
        title: `Frage seit über 24 Std. offen · ${q.community_channels?.title ?? ""}`,
        text: `${n.get(q.author_id)?.name ?? "Elternteil"}: „${String(q.body).slice(0, 140)}“`,
        suggestion: "Kurz antworten. Die Antwort erscheint direkt im Kanal.",
        at: q.created_at,
        href: `/admin-elternkabine?kanal=${q.channel_id}&beitrag=${q.id}`,
        actions: [
          {
            id: "reply",
            label: "Antworten",
            post_id: q.id,
            channel_id: q.channel_id,
          },
        ],
      })),
    ...(drafts ?? []).map((c: any) => ({
      key: `ek-draft:${c.id}`,
      type: "draft",
      tone: "purple",
      title: `Kanal wartet auf die erste Nachricht · ${c.title}`,
      text: "Der Kanal ist für Eltern erst sichtbar, wenn das Team ihn mit einer Nachricht eröffnet.",
      suggestion: draftSuggestion(c),
      at: null,
      href: `/admin-elternkabine?kanal=${c.id}`,
      actions: [
        {
          id: "publish",
          label: "Mit Vorschlag eröffnen",
          channel_id: c.id,
          text: draftSuggestion(c),
        },
      ],
    })),
  ];
  return { alerts };
}
function draftSuggestion(c: { title: string; kind: string }) {
  if (c.kind === "trial")
    return "Willkommen beim Probetraining! Stellt hier gern eure Fragen, wir antworten so schnell wie möglich.";
  return `Willkommen in „${c.title}“! Hier tauscht ihr euch aus, stellt Fragen und helft euch gegenseitig. Bitte bleibt freundlich und postet keine Fotos fremder Kinder.`;
}
const REPORT_REASON_LABELS: Record<string, string> = {
  insult: "Beleidigung",
  ads: "Werbung",
  photo: "Foto",
  privacy: "Privatsphäre",
  other: "Sonstiges",
};
/** Mehrere Meldungen zum selben Beitrag werden zu einem Glocken-Eintrag. */
function reportGroups(reports: any[]) {
  const byPost = new Map<
    string,
    { r: any; count: number; reasons: Set<string> }
  >();
  for (const r of reports) {
    const g = byPost.get(r.post_id);
    if (g) {
      g.count++;
      if (r.reason) g.reasons.add(r.reason);
    } else
      byPost.set(r.post_id, {
        r,
        count: 1,
        reasons: new Set(r.reason ? [r.reason] : []),
      });
  }
  return [...byPost.values()].map((g) => ({
    r: g.r,
    count: g.count,
    reasons: [...g.reasons].map((x) => REPORT_REASON_LABELS[x] ?? x).join(", "),
  }));
}

export async function alertAction(input: unknown) {
  const s = await session();
  if (s.role !== "admin" && s.role !== "staff")
    throw new HttpError(403, "Keine Berechtigung.");
  const body = z
    .object({
      action: z.enum(["reply", "publish", "hide", "dismiss"]),
      post_id: id.optional(),
      channel_id: id.optional(),
      report_id: id.optional(),
      text: z.string().trim().max(4000).optional(),
    })
    .parse(input);
  if (body.action === "reply" || body.action === "publish") {
    if (!body.text) throw new HttpError(400, "Bitte Text eingeben.");
    return createPost({
      channel_id: body.channel_id,
      body: body.text,
      kind: body.action === "publish" ? "info" : "text",
      reply_to: body.action === "reply" ? body.post_id : null,
    });
  }
  return moderate({
    action: body.action === "hide" ? "hide" : "dismiss",
    post_id: body.post_id,
    report_id: body.report_id,
  });
}

const moderateSchema = z.object({
  action: z.enum([
    "hide",
    "unhide",
    "dismiss",
    "pin",
    "unpin",
    "solve",
    "mute",
    "ban",
    "unban",
  ]),
  post_id: id.optional(),
  report_id: id.optional(),
  user_id: id.optional(),
  solved_by: id.optional(),
  reason: z.string().max(200).optional(),
});
export async function moderate(input: unknown) {
  const s = await session();
  if (s.role !== "admin" && s.role !== "staff")
    throw new HttpError(403, "Keine Berechtigung.");
  const b = moderateSchema.parse(input);
  const now = new Date().toISOString();
  const resolveReports = async (state: "resolved" | "dismissed") => {
    let q = db()
      .from("community_reports")
      .update({ state, resolved_by: s.user.id, resolved_at: now })
      .eq("state", "open");
    q = b.report_id ? q.eq("id", b.report_id) : q.eq("post_id", b.post_id!);
    ok(await q);
  };
  if (b.action === "hide" && b.post_id) {
    ok(
      await db()
        .from("community_posts")
        .update({
          hidden_at: now,
          hidden_by: s.user.id,
          hidden_reason: b.reason ?? "team",
        })
        .eq("id", b.post_id),
    );
    await resolveReports("resolved");
  } else if (b.action === "unhide" && b.post_id)
    ok(
      await db()
        .from("community_posts")
        .update({ hidden_at: null, hidden_by: null, hidden_reason: null })
        .eq("id", b.post_id),
    );
  else if (b.action === "dismiss") {
    if (b.post_id && !b.report_id)
      ok(
        await db()
          .from("community_posts")
          .update({ hidden_at: null })
          .eq("id", b.post_id)
          .eq("hidden_reason", "auto_reports"),
      );
    await resolveReports("dismissed");
  } else if ((b.action === "pin" || b.action === "unpin") && b.post_id)
    ok(
      await db()
        .from("community_posts")
        .update({ pinned: b.action === "pin" })
        .eq("id", b.post_id),
    );
  else if (b.action === "solve" && b.post_id)
    ok(
      await db()
        .from("community_posts")
        .update({ solved_by: b.solved_by ?? null })
        .eq("id", b.post_id),
    );
  else if (["mute", "ban", "unban"].includes(b.action) && b.user_id) {
    if (s.role !== "admin") throw new HttpError(403, "Nur Admins.");
    ok(
      await db()
        .from("community_members")
        .upsert(
          {
            user_id: b.user_id,
            ...(b.action === "mute"
              ? {
                  muted_until: new Date(
                    Date.now() + 7 * 86400000,
                  ).toISOString(),
                }
              : {
                  banned_at: b.action === "ban" ? now : null,
                  muted_until: null,
                }),
          },
          { onConflict: "user_id" },
        ),
    );
  } else throw new HttpError(400, "Unbekannte Aktion.");
  return { ok: true };
}

export async function adminOverview() {
  const s = await requireAdmin();
  await db().rpc("community_sync_channels");
  const [channels, counts, reports, locations, flags, posts] =
    await Promise.all([
      db().from("community_channels").select("*").order("sort").then(ok),
      db().rpc("community_member_counts").then(ok),
      db()
        .from("community_reports")
        .select(
          "id,reason,note,state,created_at,post_id,community_posts(body,channel_id,hidden_at,author_id)",
        )
        .order("created_at", { ascending: false })
        .limit(50)
        .then(ok),
      db()
        .from("locations")
        .select("id,name,is_region,active")
        .order("name")
        .then(ok),
      elternkabineFlags(),
      db()
        .from("community_posts")
        .select("channel_id,created_at")
        .is("deleted_at", null)
        .gt("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
        .then(ok),
    ]);
  const { count: families } = await db()
    .from("community_families")
    .select("parent_id", { count: "exact", head: true })
    .eq("enabled", true);
  const { count: coParents } = await db()
    .from("parent_co_accounts")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");
  return {
    me: s.user.id,
    flags,
    families: families ?? 0,
    co_parents: coParents ?? 0,
    channels: (channels ?? []).map((c: any) => ({
      ...c,
      members:
        ((counts ?? []) as any[]).find((x) => x.channel_id === c.id)?.members ??
        0,
      posts_7d: (posts ?? []).filter((p: any) => p.channel_id === c.id).length,
    })),
    reports: reports ?? [],
    locations: locations ?? [],
  };
}
export async function adminSettings(input: unknown) {
  const s = await requireAdmin();
  const b = z
    .discriminatedUnion("type", [
      z.object({
        type: z.literal("feature"),
        key: z.enum(["elternkabine", "elternkabine_child_photos"]),
        enabled: z.boolean(),
      }),
      z.object({
        type: z.literal("region"),
        location_id: id,
        is_region: z.boolean(),
      }),
      z.object({
        type: z.literal("channel"),
        channel_id: id,
        status: z.enum(["active", "readonly", "archived"]),
      }),
    ])
    .parse(input);
  if (b.type === "feature") {
    const { error } = await s.db.rpc("set_platform_feature", {
      feature_key: b.key,
      wanted: b.enabled,
      expected: !b.enabled,
    });
    if (error)
      throw new HttpError(
        409,
        "Schalter wurde gerade geändert. Bitte neu laden.",
      );
  } else if (b.type === "region") {
    ok(
      await db()
        .from("locations")
        .update({ is_region: b.is_region })
        .eq("id", b.location_id),
    );
    ok(await db().rpc("community_sync_channels"));
  } else
    ok(
      await db()
        .from("community_channels")
        .update({ status: b.status })
        .eq("id", b.channel_id),
    );
  return { ok: true };
}
