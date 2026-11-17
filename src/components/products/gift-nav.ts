"use client";
// Menüpunkt für Eltern: mit Geschenkguthaben "Geschenkkarten" (Codes und
// Guthaben), sonst "Geschenkkarte kaufen" mit Sprung zum Geschenkkartenprodukt.
import { useEffect, useState } from "react";

export type GiftNav = { credit: boolean } | null;
export const giftBuyHref = "/produkte?channel=parents&kaufen=geschenkkarte";

export function useGiftNav(active: boolean): GiftNav {
  const [state, setState] = useState<GiftNav>(null);
  useEffect(() => {
    if (!active) return;
    let live = true;
    const load = () =>
      fetch("/api/products/gifts/mine", {
        credentials: "same-origin",
        cache: "no-store",
      })
        .then(async (res) => {
          if (!live) return;
          // Geschenkkarten ausgeschaltet oder kein Elternzugang: kein Menüpunkt.
          if (!res.ok) return setState(null);
          const value = (await res.json()) as { available?: number };
          setState({ credit: (value.available ?? 0) > 0 });
        })
        .catch(() => {});
    void load();
    const update = (e: Event) => {
      const value = (e as CustomEvent<{ available?: number }>).detail;
      if (live && value) setState({ credit: (value.available ?? 0) > 0 });
    };
    window.addEventListener("pa:gift-account-updated", update);
    return () => {
      live = false;
      window.removeEventListener("pa:gift-account-updated", update);
    };
  }, [active]);
  return state;
}
