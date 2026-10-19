"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { paiSuggestions } from "@/lib/pai/suggestions";

/** Each new blob URL restarts the transparent animation (five seconds). */
export function MascotCycle({
  role,
  onQuestion,
  showSuggestions = true,
  showMascot = false,
}: {
  role: string;
  showSuggestions?: boolean;
  showMascot?: boolean;
  onQuestion: (question: string) => void;
}) {
  const slot = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const [assets, setAssets] = useState<Blob[]>([]);
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<"playing" | "holding" | "hidden">(
    "playing",
  );
  const [source, setSource] = useState<{ round: number; url: string } | null>(
    null,
  );
  const [loaded, setLoaded] = useState(false);
  const [reduced, setReduced] = useState(false);
  const mascot = (round % 2) + 1;
  const questions = paiSuggestions(role);
  const question = questions[round % questions.length];
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!showMascot) {
      setAssets([]);
      return;
    }
    const controller = new AbortController();
    Promise.all(
      [1, 2].map(async (n) => {
        const response = await fetch(`/pai-mascots/${n}.webp`, {
          signal: controller.signal,
          cache: "force-cache",
        });
        if (!response.ok) throw Error("GIF unavailable");
        return response.blob();
      }),
    )
      .then((blobs) => {
        if (!controller.signal.aborted) setAssets(blobs);
      })
      .catch(() => {});
    return () => {
      controller.abort();
    };
  }, [showMascot]);
  useEffect(() => {
    if (!showMascot || !assets.length || phase !== "playing" || reduced) return;
    const url = URL.createObjectURL(assets[round % 2]);
    setSource({ round, url });
    setLoaded(false);
    return () => URL.revokeObjectURL(url);
  }, [assets, round, phase, reduced, showMascot]);
  useEffect(() => {
    if (
      reduced ||
      (showMascot && (!assets.length || (phase === "playing" && !loaded)))
    )
      return;
    const timer = window.setTimeout(
      () => {
        if (phase === "playing") setPhase("holding");
        else if (phase === "holding") setPhase("hidden");
        else {
          setRound((n) => n + 1);
          setPhase("playing");
          setLoaded(false);
        }
      },
      phase === "playing" ? 5000 : 10000,
    );
    return () => window.clearTimeout(timer);
  }, [assets.length, phase, loaded, reduced, showMascot]);
  useLayoutEffect(() => {
    const update = () => {
      const rect = slot.current?.getBoundingClientRect();
      setPosition(
        rect ? { top: rect.top, left: rect.left, width: rect.width } : null,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    if (slot.current) observer.observe(slot.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [phase, reduced, assets.length, round, showMascot]);
  // With reduced motion show a quiet static prompt; no automatically repeating animation.
  if (
    (showMascot && !assets.length) ||
    (!reduced && phase === "hidden") ||
    (!showMascot && !showSuggestions)
  )
    return null;
  const holding = reduced || phase === "holding";
  const currentSource = source?.round === round ? source.url : "";
  return (
    <div
      className={`pai-mascot-stage${showMascot ? "" : " pai-speech-only"}`}
      data-phase={holding ? "holding" : phase}
      data-mascot={mascot}
    >
      {holding && showSuggestions && (
        <button
          type="button"
          className="pai-speech"
          onClick={() => onQuestion(question)}
        >
          <span>Frag pAi zum Beispiel</span>
          <strong>{question}</strong>
          <small>Frage im Chat öffnen ↗</small>
        </button>
      )}
      {showMascot && (
        <span className="pai-mascot-slot" ref={slot} aria-hidden="true" />
      )}
      {showMascot &&
        (holding || currentSource) &&
        position &&
        createPortal(
          <img
            className="pai-mascot-image"
            style={{
              position: "fixed",
              top: position.top,
              left: position.left,
              width: position.width,
            }}
            key={holding ? `still-${mascot}` : currentSource}
            src={holding ? `/pai-mascots/${mascot}-last.png` : currentSource}
            width="180"
            height="320"
            alt=""
            aria-hidden="true"
            onLoad={() => {
              if (!holding && currentSource) setLoaded(true);
            }}
            onError={() => setPhase("holding")}
          />,
          document.body,
        )}
    </div>
  );
}
