"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, MapPin, CalendarDays } from "lucide-react";
import { DiscountCopy } from "./discount-copy";
import { type Camp, money } from "@/lib/camps/domain";
import { CampFrame, CampError, campApi, useCampLogin, date } from "./shared";
type Child = {
  id: string;
  first_name: string;
  last_name: string;
  camp_birth_date?: string;
  camp_gender?: string;
  camp_clothing_size?: string;
};
type Data = {
  camp: Camp;
  occupied: number;
  maximum: number;
  offer: { amount: number; currency: string; kind: string } | null;
  context: {
    role: string | null;
    children: Child[];
    parent: { full_name: string; contact_email: string } | null;
  };
};
export function BookingForm({ campId }: { campId: string }) {
  const loginHref = useCampLogin();
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [mode, setMode] = useState(""),
    [busy, setBusy] = useState(false),
    [player, setPlayer] = useState(""),
    [discount, setDiscount] = useState<{
      percent: number;
      code: string | null;
    }>({ percent: 0, code: null });
  const [parent, setParent] = useState({ name: "", email: "", phone: "" });
  const [child, setChild] = useState({
    first_name: "",
    last_name: "",
    birth_date: "",
    gender: "keine Angabe",
    clothing_size: "",
  });
  useEffect(() => {
    let current = true;
    campApi(`public/${campId}`)
      .then((d: Data) => {
        if (!current) return;
        setData(d);
        if (d.context.role === "parent") {
          setMode("existing");
          setParent((p) => ({
            ...p,
            name: d.context.parent?.full_name ?? "",
            email: d.context.parent?.contact_email ?? "",
          }));
        } else {
          try {
            const p = sessionStorage.getItem("camp_parent");
            if (p) {
              setParent(JSON.parse(p));
              setMode("new");
            }
          } catch {}
        }
      })
      .catch((e) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [campId]);
  function selectChild(id: string) {
    setPlayer(id);
    setDiscount({ percent: 0, code: null });
    const c = data?.context.children.find((c) => c.id === id);
    if (c)
      setChild({
        first_name: c.first_name,
        last_name: c.last_name,
        birth_date: c.camp_birth_date ?? "",
        gender: c.camp_gender ?? "keine Angabe",
        clothing_size: c.camp_clothing_size ?? "",
      });
  }
  useEffect(() => {
    if (!player) return;
    let current = true;
    campApi(`discount?camp_id=${campId}&player_id=${player}`)
      .then((d) => {
        if (current) setDiscount(d);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [player, campId]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await campApi("book", {
        camp_id: campId,
        player_id: player || undefined,
        parent,
        child,
      });
      sessionStorage.setItem("camp_parent", JSON.stringify(parent));
      location.assign(result.url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <CampFrame>
      <CampError message={error} />
      {!data ? (
        <p>Camp wird geladen …</p>
      ) : (
        <>
          <div className="camp-eyebrow">
            DEIN NÄCHSTER SCHRITT AUF DEM PLATZ
          </div>
          <h1>
            {data.camp.title}
            <span>.</span>
          </h1>
          <div className="camp-summary">
            <span>
              <MapPin size={17} />
              {data.camp.location}
            </span>
            <span>
              <CalendarDays size={17} />
              {data.camp.days.length}{" "}
              {data.camp.days.length === 1 ? "Trainingstag" : "Trainingstage"}
            </span>
            <strong>
              {data.offer
                ? money(data.offer.amount, data.offer.currency)
                : "Preis folgt"}
            </strong>
          </div>
          <p>{data.camp.description}</p>
          <div className="camp-days">
            {data.camp.days.map((d, i) => (
              <p key={d.starts_at}>
                <b>Tag {i + 1}</b> · {date(d.starts_at)} –{" "}
                {new Intl.DateTimeFormat("de-DE", {
                  timeZone: "Europe/Berlin",
                  timeStyle: "short",
                }).format(new Date(d.ends_at))}{" "}
                Uhr
              </p>
            ))}
          </div>
          {data.offer?.kind === "early" && (
            <p className="camp-success">
              Frühbucherpreis bis {date(data.camp.early_bird_until!)}.
              Berechtigte Abo-Rabatte können zusätzlich eingelöst werden.
            </p>
          )}
          {data.camp.status !== "open" || data.occupied >= data.maximum ? (
            <div className="camp-panel">
              <h2>Anmeldung geschlossen</h2>
              <p>
                Für dieses Camp sind aktuell keine weiteren Buchungen möglich.
              </p>
            </div>
          ) : (
            <>
              {!mode && (
                <section className="camp-panel">
                  <h2>Wie möchtest du buchen?</h2>
                  <div className="camp-actions">
                    <Link
                      className="secondary-button"
                      href={loginHref}
                      onClick={() =>
                        sessionStorage.setItem("camp_return", location.pathname)
                      }
                    >
                      Bereits Kunde? Anmelden
                    </Link>
                    <button
                      className="primary-button"
                      onClick={() => setMode("new")}
                    >
                      Neu bei uns
                    </button>
                  </div>
                  <p>
                    Eine Buchung gilt für genau ein Kind. Weitere Kinder kannst
                    du anschließend buchen.
                  </p>
                </section>
              )}
              {mode && (
                <form onSubmit={submit} className="camp-panel camp-form">
                  <h2>1. Elternangaben</h2>
                  <div className="camp-grid">
                    <label>
                      Name
                      <input
                        required
                        value={parent.name}
                        readOnly={mode === "existing"}
                        onInput={(e) =>
                          setParent({ ...parent, name: e.currentTarget.value })
                        }
                      />
                    </label>
                    <label>
                      E-Mail
                      <input
                        type="email"
                        required
                        value={parent.email}
                        readOnly={mode === "existing"}
                        onInput={(e) =>
                          setParent({ ...parent, email: e.currentTarget.value })
                        }
                      />
                    </label>
                    <label>
                      Telefon für Rückfragen
                      <input
                        type="tel"
                        required
                        value={parent.phone}
                        onInput={(e) =>
                          setParent({ ...parent, phone: e.currentTarget.value })
                        }
                      />
                    </label>
                  </div>
                  <h2>2. Dein Kind</h2>
                  {mode === "existing" && (
                    <label>
                      Kind auswählen
                      <select
                        required
                        value={player}
                        onChange={(e) => selectChild(e.target.value)}
                      >
                        <option value="">Bitte auswählen</option>
                        {data.context.children.map((c) => (
                          <option value={c.id} key={c.id}>
                            {c.first_name} {c.last_name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className="camp-grid">
                    <label>
                      Vorname
                      <input
                        required
                        readOnly={mode === "existing"}
                        value={child.first_name}
                        onChange={(e) =>
                          setChild({ ...child, first_name: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Nachname
                      <input
                        required
                        readOnly={mode === "existing"}
                        value={child.last_name}
                        onChange={(e) =>
                          setChild({ ...child, last_name: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Geburtsdatum
                      <input
                        type="date"
                        required
                        value={child.birth_date}
                        onInput={(e) =>
                          setChild({
                            ...child,
                            birth_date: e.currentTarget.value,
                          })
                        }
                        onChange={(e) =>
                          setChild({ ...child, birth_date: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Geschlecht
                      <select
                        value={child.gender}
                        onChange={(e) =>
                          setChild({ ...child, gender: e.target.value })
                        }
                      >
                        {["keine Angabe", "weiblich", "männlich", "divers"].map(
                          (g) => (
                            <option key={g}>{g}</option>
                          ),
                        )}
                      </select>
                    </label>
                    <label>
                      Kleidergröße
                      <select
                        required
                        value={child.clothing_size}
                        onChange={(e) =>
                          setChild({ ...child, clothing_size: e.target.value })
                        }
                      >
                        <option value="">Bitte auswählen</option>
                        {[
                          "116",
                          "128",
                          "140",
                          "152",
                          "164",
                          "XS",
                          "S",
                          "M",
                          "L",
                          "XL",
                          "XXL",
                        ].map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <h2>3. Zur Zahlung</h2>
                  {discount.code ? (
                    <div className="camp-discount">
                      <DiscountCopy
                        key={discount.code}
                        code={discount.code}
                        percent={discount.percent}
                      />
                      <p>
                        Den kopierten Code bei der Zahlung im Feld für
                        Rabattcodes einsetzen. Dort siehst du den endgültigen
                        Betrag.
                      </p>
                    </div>
                  ) : (
                    <p>
                      {player
                        ? "Für dieses Kind ist aktuell kein einlösbarer Abo-Rabatt hinterlegt."
                        : "Ohne aktives Abo gilt der angezeigte Camp-Preis."}
                    </p>
                  )}
                  <p>
                    Dein Platz ist erst nach bestätigter Zahlung gebucht. Das
                    Formular reserviert keinen Platz.
                  </p>
                  <CampError message={error} />
                  <button
                    className="primary-button"
                    disabled={busy || !data.offer}
                  >
                    {busy ? "Zahlung wird vorbereitet …" : "Weiter zur Zahlung"}
                    <ArrowRight size={18} />
                  </button>
                  <Link href="/camps" className="text-button">
                    Abbrechen
                  </Link>
                </form>
              )}
            </>
          )}
        </>
      )}
    </CampFrame>
  );
}
