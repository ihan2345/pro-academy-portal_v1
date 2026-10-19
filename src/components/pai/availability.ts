"use client";
import { useEffect, useState } from "react";

/** UI follows the global switch; every pAi operation still checks it server-side. */
export function usePaiAvailability(section: string) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let live = true;
    let pending: AbortController | undefined;
    async function refresh() {
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      try {
        const response = await fetch("/api/platform/availability", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = response.ok ? await response.json() : null;
        if (live && !controller.signal.aborted) setVisible(data?.pai === true);
      } catch {
        if (live && !controller.signal.aborted) setVisible(false);
      }
    }
    const update = () => {
      void refresh();
    };
    const focus = () => {
      if (!document.hidden) update();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === "platform-features-changed") update();
    };
    update();
    const timer = window.setInterval(focus, 30000);
    window.addEventListener("platform-features-changed", update);
    window.addEventListener("storage", storage);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      live = false;
      pending?.abort();
      window.clearInterval(timer);
      window.removeEventListener("platform-features-changed", update);
      window.removeEventListener("storage", storage);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [section]);
  return visible;
}
