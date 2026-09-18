export async function campApi(path: string, body?: unknown) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35000);
  try {
    const r = await fetch(`/api/camp/${path}`, {
      signal: controller.signal,
      ...(body === undefined
        ? { cache: "no-store" as const }
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    if (!r.headers.get("content-type")?.includes("application/json"))
      throw new Error(
        "Die Camp-Seite wird gerade neu geladen. Bitte erneut versuchen.",
      );
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? "Anfrage fehlgeschlagen.");
    return data;
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error(
        "Die Verbindung dauert zu lange. Bitte versuche es erneut. Eine Zahlung wurde dadurch nicht ausgelöst.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
