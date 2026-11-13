"use client";
import { useEffect, useRef, useState } from "react";
import { ProductShowcase, type ProductDisplay } from "./shared";
import type { Decision } from "@/lib/products/policy";
type Row = ProductDisplay & { id: string; decision: Decision };
export function ShowcaseEmbed({ token }: { token: string }) {
  const rootRef = useRef<HTMLElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [message, setMessage] = useState("Angebote werden geladen …");
  useEffect(() => {
    const root = rootRef.current;
    if (!root || window.parent === window) return;

    let parentOrigin: string | null = null;
    let lastHeight = 0;
    let animationFrame = 0;

    const reportHeight = () => {
      if (!parentOrigin) return;
      const height = Math.ceil(root.getBoundingClientRect().height);
      if (height === lastHeight) return;
      lastHeight = height;
      window.parent.postMessage(
        { type: "proacademy:showcase:height", height },
        parentOrigin,
      );
    };

    const scheduleHeightReport = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(reportHeight);
    };

    const receiveViewport = (event: MessageEvent) => {
      if (
        event.source !== window.parent ||
        event.origin === "null" ||
        event.data?.type !== "proacademy:showcase:viewport"
      ) {
        return;
      }
      const height: unknown = event.data.height;
      if (
        typeof height !== "number" ||
        !Number.isFinite(height) ||
        height <= 0
      ) {
        return;
      }
      parentOrigin = event.origin;
      // Use the outer viewport as the minimum, not the growing iframe itself.
      // Otherwise viewport units can cause a resize feedback loop.
      root.style.setProperty("--showcase-viewport-height", `${height}px`);
      scheduleHeightReport();
    };

    const observer = new ResizeObserver(scheduleHeightReport);
    observer.observe(root);
    window.addEventListener("message", receiveViewport);
    // The parent may have sent its first viewport before hydration completed.
    window.parent.postMessage({ type: "proacademy:showcase:ready" }, "*");

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("message", receiveViewport);
    };
  }, []);
  useEffect(() => {
    let live = true;
    let active: AbortController | null = null;
    async function load() {
      if (active) return;
      const controller = new AbortController();
      active = controller;
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(`/api/public/product-showcase/${token}`, {
          cache: "no-store",
          credentials: "omit",
          signal: controller.signal,
        });
        if (!response.ok) throw Error("Einbettung derzeit nicht verfügbar.");
        const data = await response.json();
        if (live) {
          setRows(data.rows);
          setMessage("Aktuell sind keine öffentlichen Angebote verfügbar.");
        }
      } catch {
        if (live) {
          setRows([]);
          setMessage("Einbettung derzeit nicht verfügbar.");
        }
      } finally {
        clearTimeout(timeout);
        active = null;
      }
    }
    void load();
    const timer = setInterval(load, 30000);
    const focus = () => void load();
    window.addEventListener("focus", focus);
    return () => {
      live = false;
      active?.abort();
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [token]);
  return (
    <main ref={rootRef} className="showcase-embed">
      {rows.length ? (
        <ProductShowcase
          products={rows}
          onAction={() => {}}
          actionHref={(p) => `/produkte?product=${p.id}`}
          imageUrl={(id) => `/api/public/product-showcase/${token}/image/${id}`}
        />
      ) : (
        <p role="status" className="showcase-embed-message">
          {message}
        </p>
      )}
      <a
        className="showcase-shop-link"
        href="/produkte"
        target="_blank"
        rel="noopener noreferrer"
      >
        Zum Shop ↗
      </a>
    </main>
  );
}
