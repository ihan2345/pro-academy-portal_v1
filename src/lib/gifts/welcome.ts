const shown = new Set<string>();
/** A presentation marker scoped to the authenticated login session, never an authorization check. */
export function claimGiftWelcome(
  data: { has_cards: boolean; available: number; welcome_key: string },
  storage: Pick<Storage, "getItem" | "setItem"> | null,
) {
  if (!data.has_cards || data.available <= 0 || !data.welcome_key) return false;
  const key = `pa:gift-welcome:${data.welcome_key}`;
  if (shown.has(key)) return false;
  try {
    if (storage?.getItem(key)) {
      shown.add(key);
      return false;
    }
    storage?.setItem(key, "1");
  } catch {}
  shown.add(key);
  return true;
}
