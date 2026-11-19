import { serviceDb } from "./service-db";
import { firstName } from "../mail-2026/from-text";

/** Vorname des Elternteils zur Empfängeradresse (für „Hallo <Vorname>,“). */
export async function parentFirstName(email: string): Promise<string> {
  if (!email) return "";
  try {
    const { data, error } = await serviceDb()
      .from("parents")
      .select("full_name")
      .ilike(
        "contact_email",
        email.replace(/[\\%_]/g, (c) => `\\${c}`),
      )
      .is("archived_at", null)
      .limit(1)
      .maybeSingle();
    if (error) return "";
    return firstName(data?.full_name);
  } catch {
    // Die Anrede darf den Versand nie blockieren.
    return "";
  }
}
