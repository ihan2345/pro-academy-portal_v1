import "server-only";
import { serviceDb } from "./service-db";
import { profileAccess, type ProfileAccess } from "../profile-access";

type Parent = {
  id: string;
  auth_user_id?: string | null;
  contact_email?: string;
};
async function collect(make: () => any, key = "id"): Promise<any[]> {
  const rows: any[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    let query = make().order(key).limit(500);
    if (after) query = query.gt(key, after);
    const { data, error } = await query;
    if (error || !Array.isArray(data))
      throw new Error("Portalstatus unvollständig");
    rows.push(...data);
    if (data.length < 500) return rows;
    const next = data.at(-1)?.[key];
    if (!next || next === after) throw new Error("Portalstatus unvollständig");
    after = next;
  }
  throw new Error("Portalstatus zu umfangreich");
}
const email = (s?: string) => (s ?? "").trim().toLowerCase();
/** Read delivery/claim evidence. Never creates users, links, or sends invitations. */
export async function readProfileAccess(
  parents: Parent[],
  role: string,
  db = serviceDb(),
) {
  const result = new Map<string, ProfileAccess>();
  if (!parents.length) return result;
  try {
    const invitations: any[] = [],
      orders: any[] = [],
      families: any[] = [],
      activity: any[] = [];
    for (let start = 0; start < parents.length; start += 100) {
      const batch = parents.slice(start, start + 100),
        ids = batch.map((p) => p.id),
        users = batch.map((p) => p.auth_user_id).filter(Boolean);
      const data = await Promise.all([
        collect(() =>
          db
            .from("parent_invitations")
            .select("id,parent_id,email,created_at,expires_at,consumed_at")
            .in("parent_id", ids),
        ),
        collect(() =>
          db
            .from("product_purchase_intents")
            .select(
              "id,parent_id,created_at,guest_email:guest_data->>email,product_guest_messages(status,sent_at)",
            )
            .in("parent_id", ids)
            .in("status", ["fulfilled", "review"]),
        ),
        collect(
          () =>
            db
              .from("product_guest_families")
              .select("parent_id,email,claimed_at")
              .in("parent_id", ids),
          "parent_id",
        ),
        users.length
          ? collect(
              () =>
                db
                  .from("user_activity")
                  .select("user_id,last_seen_at")
                  .in("user_id", users),
              "user_id",
            )
          : [],
      ]);
      invitations.push(...data[0]);
      orders.push(...data[1]);
      families.push(...data[2]);
      activity.push(...data[3]);
    }
    const jobs: any[] = [];
    for (let start = 0; start < invitations.length; start += 100) {
      const ids = invitations.slice(start, start + 100).map((i) => i.id);
      jobs.push(
        ...(await collect(() =>
          db
            .from("notification_jobs")
            .select(
              "id,invitation_id:payload->>invitation_id,recipient,status,updated_at,notification_deliveries(recipient,provider,status,created_at)",
            )
            .eq("kind", "invitation")
            .in("payload->>invitation_id", ids),
        )),
      );
    }
    for (const parent of parents) {
      const relevant = invitations.filter(
        (i) =>
          i.parent_id === parent.id &&
          email(i.email) === email(parent.contact_email),
      );
      const inv = relevant.map((i) => {
        const job = jobs.find(
          (j) =>
            j.invitation_id === i.id &&
            email(j.recipient) === email(parent.contact_email),
        );
        const sent =
          job?.status === "sent"
            ? job.notification_deliveries
                ?.filter(
                  (d: any) =>
                    d.provider === "proton" &&
                    d.status === "sent" &&
                    email(d.recipient) === email(parent.contact_email),
                )
                .sort((a: any, b: any) =>
                  b.created_at.localeCompare(a.created_at),
                )[0]
            : null;
        return {
          ...i,
          status: job?.status,
          sent_confirmed: !!sent,
          sent_at: sent?.created_at ?? null,
        };
      });
      const messages = orders
        .filter(
          (i) =>
            i.parent_id === parent.id &&
            email(i.guest_email) === email(parent.contact_email),
        )
        .flatMap((i) => {
          const rows = Array.isArray(i.product_guest_messages)
            ? i.product_guest_messages
            : i.product_guest_messages
              ? [i.product_guest_messages]
              : [];
          return rows.map((m: any) => ({ ...m, created_at: i.created_at }));
        });
      const access = profileAccess({
        activated: !!parent.auth_user_id,
        lastSeen: activity.find((a) => a.user_id === parent.auth_user_id)
          ?.last_seen_at,
        invitations: inv,
        guestMessages: messages,
        claimedAt: families.find(
          (f) =>
            f.parent_id === parent.id &&
            email(f.email) === email(parent.contact_email),
        )?.claimed_at,
        now: new Date().toISOString(),
      });
      if (role !== "admin") access.last_seen_at = null;
      result.set(parent.id, access);
    }
  } catch {
    for (const p of parents)
      result.set(p.id, {
        activated: !!p.auth_user_id,
        signed_in: false,
        last_seen_at: null,
        complete: false,
        invitation: {
          status: "unknown",
          kind: "invitation",
          sent_at: null,
          accepted_at: null,
        },
      });
  }
  return result;
}
