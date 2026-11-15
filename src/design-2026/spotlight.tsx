"use client";
// Design 2026: Schnellsuche im Stil von Spotlight (⌘K / Strg+K).
// Rein für die Navigation: öffnet nur Seiten, die schon im Menü stehen.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type SpotlightItem = {
  href: string;
  title: string;
  icon: LucideIcon;
  group?: string;
};

export function Spotlight({ items }: { items: SpotlightItem[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) =>
        !q ||
        i.title.toLowerCase().includes(q) ||
        (i.group ?? "").toLowerCase().includes(q),
    );
  }, [items, query]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    requestAnimationFrame(() => input.current?.focus());
  }, [open]);
  function go(item?: SpotlightItem) {
    if (!item) return;
    setOpen(false);
    router.push(item.href);
  }
  return (
    <>
      <button
        type="button"
        className="d26-spotlight-trigger"
        onClick={() => setOpen(true)}
        aria-label="Suchen"
      >
        <Search size={15} />
        <span>Suchen</span>
        <kbd>⌘K</kbd>
      </button>
      {open && (
        <div
          className="d26-spotlight-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="d26-spotlight" role="dialog" aria-label="Suchen">
            <label className="d26-spotlight-input">
              <Search size={20} />
              <input
                ref={input}
                value={query}
                placeholder="Wohin möchtest du?"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((a) => Math.min(a + 1, results.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => Math.max(a - 1, 0));
                  } else if (e.key === "Enter") go(results[active]);
                }}
              />
              <kbd>esc</kbd>
            </label>
            <ul>
              {results.map((item, i) => (
                <li key={item.href}>
                  <button
                    type="button"
                    className={i === active ? "is-active" : ""}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(item)}
                  >
                    <span className="d26-spotlight-icon">
                      <item.icon size={17} />
                    </span>
                    <span>{item.title}</span>
                    {item.group && <small>{item.group}</small>}
                    <CornerDownLeft size={14} className="d26-enter" />
                  </button>
                </li>
              ))}
              {!results.length && (
                <li className="d26-spotlight-empty">Nichts gefunden.</li>
              )}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
