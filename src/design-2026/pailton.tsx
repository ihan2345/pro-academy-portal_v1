"use client";
// Design 2026: PAiLTON sitzt unten im Menü statt der Box „Wir sind für dich da“.
// Das Maskottchen ist immer zu sehen und spielt alle 20 Sekunden seine
// Animation, dazu erscheint eine Sprechblase mit einer Beispielfrage.
// Maskottchen und Sprechblase öffnen beide den Chat. WhatsApp wandert als
// kleines Symbol mit Hover-Box an den rechten Rand.
import { useEffect, useState } from "react";
import { ArrowUpRight, MessageCircle } from "lucide-react";
import { paiSuggestions } from "@/lib/pai/suggestions";
import { PaiChat } from "@/components/pai/chat";
import { Modal } from "@/components/portal";

const CYCLE = 20000;
const PLAY = 5000;
const BUBBLE = 9000;

/** Schmale Ansicht (Handy): dort bleibt das bisherige Layout. */
export function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}

export function PailtonDock({
  role,
  collapsed,
  showMascot,
  showSuggestions = true,
}: {
  role: string;
  collapsed: boolean;
  showMascot: boolean;
  showSuggestions?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [revision, setRevision] = useState(0);
  const [round, setRound] = useState(0);
  const [playing, setPlaying] = useState<string | null>(null);
  const [bubble, setBubble] = useState(false);
  const [assets, setAssets] = useState<Blob[]>([]);
  const [reduced, setReduced] = useState(false);
  const questions = paiSuggestions(role);
  const question = questions[round % questions.length];
  const mascot = (round % 2) + 1;

  useEffect(() => {
    const update = () => setRevision((n) => n + 1);
    window.addEventListener("pai-preference", update);
    return () => window.removeEventListener("pai-preference", update);
  }, []);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  // Animationen einmal laden; jede neue Blob-Adresse startet sie von vorn.
  useEffect(() => {
    if (!showMascot) return;
    const controller = new AbortController();
    Promise.all(
      [1, 2].map(async (n) => {
        const r = await fetch(`/pai-mascots/${n}.webp`, {
          signal: controller.signal,
          cache: "force-cache",
        });
        if (!r.ok) throw Error("Animation nicht verfügbar");
        return r.blob();
      }),
    )
      .then((blobs) => !controller.signal.aborted && setAssets(blobs))
      .catch(() => {});
    return () => controller.abort();
  }, [showMascot]);
  // Takt: alle 20 Sekunden eine neue Runde mit Animation und Sprechblase.
  useEffect(() => {
    if (reduced) return;
    const timer = window.setInterval(() => setRound((n) => n + 1), CYCLE);
    return () => window.clearInterval(timer);
  }, [reduced]);
  useEffect(() => {
    if (reduced) return;
    setBubble(true);
    const hide = window.setTimeout(() => setBubble(false), BUBBLE);
    let url: string | null = null;
    let stop: number | undefined;
    if (assets.length) {
      url = URL.createObjectURL(assets[round % 2]);
      setPlaying(url);
      stop = window.setTimeout(() => setPlaying(null), PLAY);
    }
    return () => {
      window.clearTimeout(hide);
      if (stop) window.clearTimeout(stop);
      if (url) URL.revokeObjectURL(url);
    };
  }, [round, assets, reduced]);

  function openChat(text: string) {
    setDraft(text);
    setOpen(true);
  }
  const showBubble =
    showSuggestions && !collapsed && (reduced || bubble) && !open;
  return (
    <div
      className={`d26-pailton${collapsed ? " is-collapsed" : ""}${showMascot ? "" : " is-plain"}`}
    >
      {showBubble && (
        <button
          type="button"
          className="d26-pailton-bubble"
          onClick={() => openChat(question)}
        >
          <span>Frag PAiLTON zum Beispiel</span>
          <strong>{question}</strong>
        </button>
      )}
      <button
        type="button"
        className="d26-pailton-mascot"
        onClick={() => openChat("")}
        aria-label="PAiLTON öffnen"
        title={collapsed ? "PAiLTON öffnen" : undefined}
      >
        {showMascot ? (
          <img
            key={playing ?? `still-${mascot}`}
            src={playing ?? `/pai-mascots/${mascot}-last.png`}
            width="180"
            height="320"
            alt=""
            onError={() => setPlaying(null)}
          />
        ) : (
          <span className="d26-pailton-icon">
            <MessageCircle size={18} />
          </span>
        )}
        {!collapsed && (
          <span className="d26-pailton-name">
            <strong>PAiLTON</strong>
            <small>Dein Academy-Assistent</small>
          </span>
        )}
      </button>
      {open && (
        <Modal
          className="pai-popup"
          title="PAiLTON · Dein Academy-Assistent"
          close={() => setOpen(false)}
        >
          <PaiChat key={revision} role={role} initialQuestion={draft} />
        </Modal>
      )}
    </div>
  );
}

/** WhatsApp als kleines Symbol; beim Darüberfahren erscheint die bisherige Box. */
export function WhatsAppFab({ number }: { number: string }) {
  return (
    <div className="d26-whatsapp">
      <div className="d26-whatsapp-card" role="tooltip" id="d26-whatsapp-card">
        <strong>Wir sind für dich da.</strong>
        <p>Fragen zum Training? Schreib unserem Team.</p>
        <span>
          WhatsApp öffnen <ArrowUpRight size={14} />
        </span>
      </div>
      <a
        className="d26-whatsapp-button"
        href={`https://wa.me/${number}`}
        target="_blank"
        rel="noreferrer"
        aria-label="Per WhatsApp schreiben"
        aria-describedby="d26-whatsapp-card"
      >
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91A9.85 9.85 0 0 0 12.04 2Zm0 18.15h-.01a8.23 8.23 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24a8.2 8.2 0 0 1 8.24 8.25c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.23.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.24 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.29Z"
          />
        </svg>
      </a>
    </div>
  );
}
