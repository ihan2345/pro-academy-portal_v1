"use client";
import { useState } from "react";
import { Download, Share2 } from "lucide-react";
import {
  giftArtwork,
  giftCardSvg,
  type GiftCardData,
  type GiftCardSide,
} from "@/lib/gifts/artwork";
const backgrounds = new Map<GiftCardSide, Promise<string>>();
async function background(side: GiftCardSide) {
  let promise = backgrounds.get(side);
  if (!promise) {
    promise = (async () => {
      const res = await fetch(giftArtwork[side].path);
      if (!res.ok) throw Error("Kartenmotiv konnte nicht geladen werden.");
      const blob = await res.blob();
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () =>
          reject(Error("Kartenmotiv konnte nicht gelesen werden."));
        reader.readAsDataURL(blob);
      });
    })();
    backgrounds.set(side, promise);
    promise.catch(() => backgrounds.delete(side));
  }
  return promise;
}
async function renderCard(data: GiftCardData, side: GiftCardSide) {
  const svg = giftCardSvg(data, side, await background(side)),
    url = URL.createObjectURL(
      new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
    );
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const a = giftArtwork[side],
      canvas = document.createElement("canvas");
    canvas.width = 1800;
    canvas.height = Math.round((1800 * a.height) / a.width);
    canvas
      .getContext("2d")!
      .drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function png(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw Error("PNG konnte nicht erstellt werden.");
  return blob;
}
export function GiftCardArtwork({ data }: { data: GiftCardData }) {
  const [side, setSide] = useState<GiftCardSide>("front"),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  async function file(both: boolean) {
    if (!both) return png(await renderCard(data, side));
    const [front, back] = await Promise.all([
      renderCard(data, "front"),
      renderCard(data, "back"),
    ]);
    const canvas = document.createElement("canvas");
    canvas.width = 1848;
    canvas.height = front.height + back.height + 72;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#f2f3f0";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(front, 24, 24);
    ctx.drawImage(back, 24, front.height + 48);
    return png(canvas);
  }
  async function exportCard(both: boolean, share = false) {
    setBusy(true);
    setNotice("");
    try {
      const blob = await file(both),
        name = `ProAcademy-Geschenkkarte-${both ? "beide-Seiten" : side === "front" ? "Vorderseite" : "Rueckseite"}.png`,
        f = new File([blob], name, { type: "image/png" });
      if (share && navigator.canShare?.({ files: [f] })) {
        await navigator.share({
          title: "Deine ProAcademy Geschenkkarte",
          files: [f],
        });
        setNotice("Geschenkkarte zum Teilen übergeben.");
      } else {
        const url = URL.createObjectURL(blob),
          a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice(
          share
            ? "PNG gespeichert. Du kannst die Datei in deinem Messenger teilen."
            : "PNG mit deinen persönlichen Angaben gespeichert.",
        );
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="gift-artwork"
      aria-label="Deine persönliche Geschenkkarte"
    >
      <div className="gift-side-switch" role="group" aria-label="Kartenseite">
        <button
          type="button"
          aria-pressed={side === "front"}
          onClick={() => setSide("front")}
        >
          Vorderseite
        </button>
        <button
          type="button"
          aria-pressed={side === "back"}
          onClick={() => setSide("back")}
        >
          Rückseite
        </button>
      </div>
      <div
        className="gift-artwork-frame"
        dangerouslySetInnerHTML={{ __html: giftCardSvg(data, side) }}
      />
      <div className="gift-artwork-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void exportCard(false)}
        >
          <Download size={16} />
          {side === "front" ? "Vorderseite" : "Rückseite"} als PNG
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void exportCard(true)}
        >
          Beide Seiten als PNG
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void exportCard(true, true)}
        >
          <Share2 size={16} />
          Karte teilen
        </button>
      </div>
      {notice && (
        <p role="status" className="gift-artwork-notice">
          {notice}
        </p>
      )}
    </section>
  );
}
