import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { required } from "./config";
export { serviceDb } from "./service-db";
export async function sessionDb() {
  const store = await cookies();
  return createServerClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll(values) {
          try {
            values.forEach(({ name, value, options }) =>
              store.set(name, value, options),
            );
          } catch {
            /* Server components cannot refresh cookies; route handlers can. */
          }
        },
      },
    },
  );
}
export async function sessionUser() {
  const db = await sessionDb();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) return null;
  const { data: profile } = await db
    .from("profiles")
    .select("role,full_name")
    .eq("id", user.id)
    .single();
  const { data: effectiveRole } = await db.rpc("current_role");
  return {
    db,
    user,
    role: effectiveRole as "parent" | "staff" | "admin" | undefined,
    name: profile?.full_name ?? "",
  };
}
