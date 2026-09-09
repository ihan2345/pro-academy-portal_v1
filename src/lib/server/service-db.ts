import "server-only";
import { createClient } from "@supabase/supabase-js";
import { required } from "./config";

export function serviceDb() {
  return createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
