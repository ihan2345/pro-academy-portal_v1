"use client";
// Design 2026: "Konto" im Stil der iOS-Einstellungen. E-Mail-Einstellung und
// Stripe-Kundenportal werden unverändert als fertige Bausteine eingesetzt.
import { useState } from "react";
import {
  ChevronRight,
  CreditCard,
  Mail,
  MessageCircle,
  ShieldCheck,
  UserRound,
  Zap,
} from "lucide-react";
import type { PortalData } from "@/lib/types";
import { formatDate, periodLabel } from "@/lib/domain";
import { Sheet } from "./ui";
import { PageHead } from "./page-head";
import { useMounted } from "./parent-experience";

const statusName: Record<string, [string, string]> = {
  active: ["Aktiv", "lime"],
  trialing: ["Testphase", "purple"],
  completed: ["Abgeschlossen", ""],
  past_due: ["Zahlung offen", "amber"],
  canceled: ["Gekündigt", "red"],
  cancelled: ["Gekündigt", "red"],
  paused: ["Pausiert", "amber"],
  upcoming: ["Geplant", "purple"],
};

type AccountProps = {
  data: PortalData;
  emailPreference: React.ReactNode;
  billing: React.ReactNode;
};

export function AccountExperience(props: AccountProps) {
  const mounted = useMounted();
  if (!mounted) return <div className="d26-experience" aria-busy="true" />;
  return <AccountView {...props} />;
}

function AccountView({ data, emailPreference, billing }: AccountProps) {
  const [history, setHistory] = useState<string | null>(null);
  const now = Date.now();
  const children = data.players.map((p) => {
    const periods = data.periods
      .filter((x) => x.player_id === p.id)
      .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
    const current =
      periods.find(
        (x) => Date.parse(x.starts_at) <= now && Date.parse(x.ends_at) > now,
      ) ?? periods[0];
    return { p, periods, current };
  });
  const open = children.find((c) => c.p.id === history);
  return (
    <div className="d26-experience d26-account">
      <section className="d26-card d26-account-hero">
        <span className="d26-account-avatar">{data.user_name.charAt(0)}</span>
        <div>
          <h2>{data.user_name}</h2>
          <p>{data.email}</p>
        </div>
        <span className="d26-pill tone-lime">
          <ShieldCheck size={13} /> Elternkonto
        </span>
      </section>

      <div className="d26-settings-group">
        <h4>Kinder & Abos</h4>
        <div className="d26-settings">
          {children.map(({ p, periods, current }) => {
            const [label, tone] = statusName[
              current?.subscription_status ?? current?.status ?? ""
            ] ?? ["Kein Abo", ""];
            const share = current
              ? Math.min(
                  1,
                  Math.max(
                    0,
                    (now - Date.parse(current.starts_at)) /
                      (Date.parse(current.ends_at) -
                        Date.parse(current.starts_at)),
                  ),
                )
              : 0;
            return (
              <button
                type="button"
                key={p.id}
                className="d26-setting"
                onClick={() => setHistory(p.id)}
              >
                <span className="d26-setting-icon tone-purple">
                  <UserRound size={17} />
                </span>
                <span className="d26-setting-main">
                  <b>
                    {p.first_name} {p.last_name}
                    {p.team && <em>{p.team}</em>}
                  </b>
                  <small>
                    {current
                      ? `${current.product_name} · ${periodLabel(current.starts_at, current.ends_at)}`
                      : "Noch kein Leistungszeitraum"}
                  </small>
                  {current && (
                    <i
                      className="d26-setting-bar"
                      data-tip={`${Math.round(share * 100)} % des Zeitraums vorbei`}
                    >
                      <em style={{ width: `${share * 100}%` }} />
                    </i>
                  )}
                </span>
                <span className={`d26-pill ${tone ? `tone-${tone}` : ""}`}>
                  {label}
                </span>
                <span className="d26-setting-count">
                  {periods.length}{" "}
                  {periods.length === 1 ? "Zeitraum" : "Zeiträume"}
                </span>
                <ChevronRight size={17} className="d26-chevron" />
              </button>
            );
          })}
        </div>
      </div>

      <div className="d26-settings-group">
        <h4>Zahlungen</h4>
        <div className="d26-settings">
          <div className="d26-setting is-static">
            <span className="d26-setting-icon tone-blue">
              <CreditCard size={17} />
            </span>
            <span className="d26-setting-main">
              <b>Rechnungen & Zahlungsmethode</b>
              <small>Sicher über Stripe verwaltet</small>
            </span>
          </div>
          <div className="d26-setting-actions">{billing}</div>
        </div>
      </div>

      <div className="d26-settings-group">
        <h4>Mitteilungen</h4>
        <div className="d26-settings">
          <div className="d26-setting is-static">
            <span className="d26-setting-icon tone-orange">
              <Mail size={17} />
            </span>
            <span className="d26-setting-main">
              <b>E-Mails von ProAcademy</b>
              <small>Trainingsplanung, Ankündigungen und Monatsberichte</small>
            </span>
          </div>
          <div className="d26-setting-embed">{emailPreference}</div>
        </div>
      </div>

      <div className="d26-settings-group">
        <h4>Hilfe</h4>
        <div className="d26-settings">
          <a
            className="d26-setting"
            href={`https://wa.me/${data.whatsapp}`}
            target="_blank"
            rel="noreferrer"
          >
            <span className="d26-setting-icon tone-lime">
              <MessageCircle size={17} />
            </span>
            <span className="d26-setting-main">
              <b>Team kontaktieren</b>
              <small>Kontaktdaten oder Zuordnungen ändern</small>
            </span>
            <ChevronRight size={17} className="d26-chevron" />
          </a>
        </div>
      </div>

      <Sheet
        open={!!open}
        onClose={() => setHistory(null)}
        eyebrow={open ? `${open.p.first_name} ${open.p.last_name}` : ""}
        title="Abo-Verlauf"
      >
        <div className="d26-mini-list">
          {open?.periods.map((x) => {
            const [label, tone] = statusName[
              x.subscription_status && x.status === "active"
                ? x.subscription_status
                : x.status
            ] ?? [x.status, ""];
            return (
              <div className="d26-mini-event" key={x.id}>
                <span className="d26-mini-index">
                  <Zap size={15} />
                </span>
                <span>
                  <b>{x.product_name}</b>
                  <small>
                    {periodLabel(x.starts_at, x.ends_at)} · {x.included_units}{" "}
                    Einheiten
                  </small>
                </span>
                <span className={`d26-pill ${tone ? `tone-${tone}` : ""}`}>
                  {label}
                </span>
              </div>
            );
          })}
          {!open?.periods.length && (
            <p className="d26-empty">Noch kein Leistungszeitraum.</p>
          )}
        </div>
        {open?.periods[0] && (
          <p className="d26-footnote">
            Erster Zeitraum ab{" "}
            {formatDate(open.periods[open.periods.length - 1].starts_at)}.
          </p>
        )}
      </Sheet>
    </div>
  );
}

/** Konto für Admins und Mitarbeitende im gleichen Aufbau. */
export function StaffAccount({
  data,
  admin,
}: {
  data: PortalData;
  admin: boolean;
}) {
  return (
    <div className="d26-experience d26-account">
      <PageHead
        title="Mein Konto"
        greeting={`Dein Zugang zum ${admin ? "Adminbereich" : "Mitarbeiterportal"}.`}
      />
      <section className="d26-card d26-account-hero">
        <span className="d26-account-avatar">{data.user_name.charAt(0)}</span>
        <div>
          <h2>{data.user_name}</h2>
          <p>{data.email}</p>
        </div>
        <span className="d26-pill tone-lime">
          <ShieldCheck size={13} /> {admin ? "Admin" : "Mitarbeiter"}
        </span>
      </section>
      <div className="d26-settings-group">
        <h4>Hilfe</h4>
        <div className="d26-settings">
          <a
            className="d26-setting"
            href={`https://wa.me/${data.whatsapp}`}
            target="_blank"
            rel="noreferrer"
          >
            <span className="d26-setting-icon tone-lime">
              <MessageCircle size={17} />
            </span>
            <span className="d26-setting-main">
              <b>Team kontaktieren</b>
              <small>Zugang oder Rolle ändern lassen</small>
            </span>
            <ChevronRight size={17} className="d26-chevron" />
          </a>
        </div>
      </div>
    </div>
  );
}
