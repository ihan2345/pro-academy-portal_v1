"use client";
import { useEffect, useState } from "react";
import { ProductShowcase, type ProductDisplay } from "./shared";
import type { Decision } from "@/lib/products/policy";
type Row = ProductDisplay & { id: string; decision: Decision };
export function ShowcaseEmbed({ token }: { token: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [message, setMessage] = useState("Angebote werden geladen …");
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
    <main className="showcase-embed">
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
