"use client";
import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { PaiLauncher } from "./pai/chat";
import { usePaiAvailability } from "./pai/availability";
import { AdminNavigation } from "./admin-navigation";
import { EmailPreference, flushEmailPreference } from "./email-preference";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  CalendarDays,
  Goal,
  FileText,
  Settings,
  MessageCircle,
  Check,
  Clock,
  MapPin,
  UserRound,
  Download,
  ArrowLeft,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  ShieldCheck,
  Zap,
  LogOut,
  Users,
  Plus,
  CheckCheck,
  CalendarCheck,
  Timer,
  Info,
  CheckCircle2,
} from "lucide-react";
import type { PortalData, Training, Period } from "@/lib/types";
import { portalHome } from "@/lib/portal-access";
import {
  attendanceStats,
  disciplineStats,
  stampSlots,
  durationLabel,
  formatDate,
  formatTime,
  durationMinutes,
  periodLabel,
  STATUS_LABELS,
  whatsappLink,
  isAttended,
  isChargedAbsence,
} from "@/lib/domain";
import { TeamView } from "./team";
import { AdminView } from "./admin";
import { StampCards } from "./stamp-cards";
import { UserActivityHeartbeat } from "./user-activity";
export function Brand() {
  return (
    <div className="brand">
      <Image
        className="brand-logo"
        src="/brand/logo-neon.png"
        alt="ProAcademy"
        width={1168}
        height={1390}
        unoptimized
      />
      <div className="brand-sub">BY AYHAN & KARAMAN</div>
    </div>
  );
}
import { backfillEvent } from "@/lib/backfills";
import { BackfillNotes, ExcusedNotes } from "./attendance-notes";

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Portal({
  initial,
  section,
  children,
}: {
  initial: PortalData;
  section: string;
  children?: React.ReactNode;
}) {
  const [data, setData] = useState(initial),
    [selected, setSelected] = useState(initial.players[0]?.id ?? ""),
    [selectedPeriod, setSelectedPeriod] = useState(""),
    [mobile, setMobile] = useState(false),
    [sidebarCollapsed, setSidebarCollapsed] = useState(false),
    [detail, setDetail] = useState<Training | null>(null),
    [toast, setToast] = useState("");
  const router = useRouter();
  const paiVisible = usePaiAvailability(section);
  useEffect(() => {
    try {
      setSidebarCollapsed(
        localStorage.getItem("proacademy-sidebar-collapsed") === "true",
      );
    } catch {}
  }, []);
  useEffect(() => {
    if (!mobile) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobile(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobile]);
  function toggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try {
      localStorage.setItem("proacademy-sidebar-collapsed", String(next));
    } catch {}
  }
  useEffect(() => {
    setData(initial);
  }, [initial]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  function update(next: PortalData) {
    setData(next);
    router.refresh();
  }
  useEffect(() => {
    const child = new URLSearchParams(window.location.search).get("child");
    if (child && data.players.some((p) => p.id === child)) {
      setSelected(child);
      setSelectedPeriod("");
    }
  }, [data.players, section]);
  const player = data.players.find((p) => p.id === selected) ?? data.players[0];
  const periods = data.periods.filter((p) => p.player_id === player?.id);
  const now = new Date();
  const period =
    periods.find((p) => p.id === selectedPeriod) ??
    periods.find(
      (p) => new Date(p.starts_at) <= now && new Date(p.ends_at) > now,
    ) ??
    periods[0];
  const events = data.events.filter((e) =>
    e.participants.some((p) => p.player_id === player?.id),
  );
  const currentEvents = events.filter((e) =>
    e.participants.some(
      (p) => p.player_id === player?.id && p.period_id === period?.id,
    ),
  );
  const rows = [
    ...currentEvents.map((e) => ({
      ...e,
      event_cancelled: e.status === "cancelled",
      status: e.participants.find((p) => p.player_id === player?.id)!.status,
    })),
    ...(data.backfills ?? [])
      .filter((b) => b.period_id === period?.id && b.player_id === player?.id)
      .map(backfillEvent),
  ];
  const stats = attendanceStats(rows);
  const splitStats = disciplineStats(rows);
  const upcoming = events
    .filter(
      (e) =>
        e.status !== "cancelled" &&
        new Date(e.starts_at) > now &&
        e.participants.some(
          (p) => p.player_id === player?.id && p.status === "planned",
        ),
    )
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = events
    .filter(
      (e) =>
        !e.participants.some(
          (p) => p.player_id === player?.id && p.status === "planned",
        ),
    )
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  const reports = data.reports.filter((r) => r.player_id === player?.id);
  const team = data.role === "staff",
    admin = data.role === "admin";
  const nav = [
    { href: "/", title: "Übersicht", icon: LayoutDashboard },
    {
      href: "/termine",
      title: "Meine Termine",
      icon: CalendarDays,
      count: upcoming.length,
    },
    { href: "/stempelkarte", title: "Stempelkarte", icon: Goal },
    { href: "/berichte", title: "Berichte", icon: FileText },
    { href: "/profil", title: "Mein Profil", icon: UserRound },
    { href: "/konto", title: "Mein Konto", icon: Settings },
  ];
  const adminNav = [
    { href: "/admin", title: "Übersicht", icon: LayoutDashboard },
    {
      href: "/admin/trainingsplanung",
      title: "Trainingsplanung",
      icon: CalendarDays,
    },
    { href: "/admin/stempelkarten", title: "Stempelkarten", icon: Goal },
    { href: "/admin/elternprofile", title: "Elternprofile", icon: Users },
    { href: "/admin/spielerprofile", title: "Spielerprofil", icon: UserRound },
    { href: "/admin/mitarbeiter", title: "Mitarbeiter", icon: UserRound },
    { href: "/admin/standorte", title: "Standorte", icon: MapPin },
    { href: "#verwaltung", title: "Verwaltung", icon: Settings },
    { href: "/admin/einstellungen", title: "Einstellungen", icon: Settings },
  ];
  const activeNav = admin
    ? adminNav
    : team
      ? [
          { href: "/team", title: "Trainingsplanung", icon: CalendarDays },
          { href: "/team/stempelkarten", title: "Stempelkarten", icon: Goal },
          { href: "/team/elternprofile", title: "Elternprofile", icon: Users },
          {
            href: "/team/spielerprofile",
            title: "Spielerprofil",
            icon: UserRound,
          },
          { href: "#verwaltung", title: "Verwaltung", icon: Settings },
          { href: "/konto", title: "Mein Konto", icon: Settings },
        ]
      : data.camp_enabled && data.camp_access && data.camp_access !== "active"
        ? nav.filter(
            (n) =>
              n.href === "/konto" ||
              n.href === "/profil" ||
              n.href === "/berichte" ||
              (data.camp_access === "past" && n.href === "/termine"),
          )
        : nav;
  if (paiVisible)
    activeNav.push({ href: "/pai", title: "pAi", icon: MessageCircle });
  if (data.camp_enabled)
    activeNav.push({ href: "/camps", title: "Camps", icon: CalendarDays });
  async function openBilling(customerId?: string) {
    try {
      const response = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(customerId ? { customer_id: customerId } : {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      window.location.assign(result.url);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Portal nicht verfügbar");
    }
  }
  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <UserActivityHeartbeat />
      {mobile && (
        <button
          className="sidebar-backdrop"
          aria-label="Menü schließen"
          tabIndex={-1}
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        id="portal-sidebar"
        className={`sidebar ${mobile ? "is-open" : ""}`}
      >
        <button
          type="button"
          className="sidebar-toggle icon-button"
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? "Menü ausklappen" : "Menü einklappen"}
          title={sidebarCollapsed ? "Menü ausklappen" : "Menü einklappen"}
          aria-expanded={!sidebarCollapsed}
          aria-controls="portal-sidebar"
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen size={20} />
          ) : (
            <PanelLeftClose size={20} />
          )}
        </button>
        <Link href={portalHome(data.role)} aria-label="ProAcademy Startseite">
          <Brand />
        </Link>
        <button
          className="mobile-close icon-button"
          onClick={() => setMobile(false)}
          aria-label="Menü schließen"
        >
          <X size={22} />
        </button>
        <div className="portal-label">
          {admin ? "ADMINBEREICH" : team ? "MITARBEITERPORTAL" : "ELTERNPORTAL"}
        </div>
        <nav>
          {activeNav.map((item) =>
            item.href === "#verwaltung" ? (
              <AdminNavigation
                key="verwaltung"
                role={admin ? "admin" : "staff"}
                section={section}
                collapsed={sidebarCollapsed && !mobile}
                expandSidebar={() => {
                  setSidebarCollapsed(false);
                  try {
                    localStorage.setItem(
                      "proacademy-sidebar-collapsed",
                      "false",
                    );
                  } catch {}
                }}
                navigate={() => setMobile(false)}
              />
            ) : (
              <Link
                className={`nav-link ${"/" + section === item.href ? "active" : ""}`}
                key={item.href}
                href={item.href}
                aria-label={item.title}
                aria-current={"/" + section === item.href ? "page" : undefined}
                title={sidebarCollapsed ? item.title : undefined}
                onClick={() => setMobile(false)}
              >
                <item.icon size={19} />
                <span>{item.title}</span>
                {"count" in item &&
                  typeof item.count === "number" &&
                  item.count > 0 && (
                    <span className="nav-count">{item.count}</span>
                  )}
              </Link>
            ),
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="support-box">
            <MessageCircle size={24} />
            <strong>Wir sind für dich da.</strong>
            <p>
              Fragen zum Training?
              <br />
              Schreib unserem Team.
            </p>
            <a
              href={`https://wa.me/${data.whatsapp}`}
              target="_blank"
              rel="noreferrer"
            >
              WhatsApp öffnen <ArrowUpRight size={15} />
            </a>
          </div>
          <div className="sidebar-motto">
            BUILT.
            <br />
            <span>NOT BORN.</span>
          </div>
          <div className="sidebar-footer">ProAcademy by Ayhan & Karaman</div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-toggle"
              onClick={() => setMobile(!mobile)}
              aria-label={mobile ? "Menü schließen" : "Menü öffnen"}
              aria-expanded={mobile}
              aria-controls="portal-sidebar"
            >
              {mobile ? <X size={22} /> : <Menu size={22} />}
            </button>
            <span>
              {admin
                ? "Adminbereich"
                : team
                  ? "Mitarbeiterportal"
                  : "Elternportal"}
            </span>
            <ChevronRight size={14} />
            <b>
              {activeNav.find((n) => n.href === "/" + section)?.title ??
                (section === "admin/pai"
                  ? "pAi verwalten"
                  : section.includes("/aktivitaeten")
                    ? section.endsWith("/alle")
                      ? "Alle Aktivitäten"
                      : "Aktivitäten"
                    : section === "konto"
                      ? "Mein Konto"
                      : section === "admin/eltern"
                        ? "Eltern"
                        : "Übersicht")}
            </b>
          </div>
          <div className="topbar-right">
            <span className="topbar-date">
              {formatDate(now.toISOString(), {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
            <span className="topbar-divider" />
            <Link
              href="/konto"
              className="avatar user-avatar"
              aria-label="Mein Konto"
            >
              {data.user_name.charAt(0)}B
            </Link>
          </div>
        </header>
        <main className="main-content">
          {data.role === "parent" &&
            (section === "" || section === "camps") && (
              <Link className="panel profile-entry" href="/profil">
                <UserRound size={24} />
                <span>
                  <strong>Mein Profil</strong>
                  <small>Deine Familie und eure Academy-Entwicklung</small>
                </span>
                <ArrowRight size={20} />
              </Link>
            )}
          {children ? (
            children
          ) : (admin || team) &&
            ["admin/stempelkarten", "team/stempelkarten"].includes(section) ? (
            <StampCards data={data} notify={setToast} />
          ) : section === "konto" && data.role !== "parent" ? (
            <>
              <div className="page-heading">
                <div>
                  <h1>
                    Mein Konto<span className="greeting-dot">.</span>
                  </h1>
                  <p>
                    Dein Zugang zum{" "}
                    {admin ? "Adminbereich" : "Mitarbeiterportal"}.
                  </p>
                </div>
              </div>
              <section className="panel account-panel">
                <h2>{data.user_name}</h2>
                <p>{data.email}</p>
                <Badge>{admin ? "Admin" : "Mitarbeiter"}</Badge>
              </section>
            </>
          ) : team || section === "admin/trainingsplanung" ? (
            <TeamView data={data} update={update} notify={setToast} />
          ) : admin ? (
            <AdminView data={data} section={section} notify={setToast} />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">DEIN SPIEL. DEINE ENTWICKLUNG.</div>
                  <h1>
                    {section === ""
                      ? `Hallo ${data.user_name}`
                      : section === "termine"
                        ? "Meine Termine"
                        : section === "stempelkarte"
                          ? "Deine Stempelkarte"
                          : section === "berichte"
                            ? "Deine Trainingsberichte"
                            : "Mein Konto"}
                    {section === "" && <span className="greeting-dot">.</span>}
                  </h1>
                  <p>
                    {section === ""
                      ? "Schön, dass du da bist. Hier bleibt das Training im Blick."
                      : section === "termine"
                        ? "Alles, was ansteht. Und alles, was schon geschafft ist."
                        : section === "stempelkarte"
                          ? "Jede Einheit ist ein Schritt nach vorne."
                          : section === "berichte"
                            ? "Die Entwicklung deines Kindes, übersichtlich dokumentiert."
                            : "Deine Familie und dein Abonnement an einem Ort."}
                  </p>
                </div>
                {player && (
                  <label className="child-switch">
                    <span className="avatar child-avatar">
                      {player.first_name.charAt(0)}
                    </span>
                    <span>
                      <small>DEIN KIND</small>
                      <select
                        aria-label="Kind auswählen"
                        value={player.id}
                        onChange={(e) => {
                          setSelected(e.target.value);
                          setSelectedPeriod("");
                          localStorage.setItem(
                            "proacademy-selected",
                            e.target.value,
                          );
                        }}
                      >
                        {data.players.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.first_name} {p.last_name}
                          </option>
                        ))}
                      </select>
                    </span>
                    <ChevronDown size={17} />
                  </label>
                )}
              </div>
              {!player ? (
                <div className="empty-state">
                  <Users />
                  <h2>Noch kein Kind zugeordnet</h2>
                  <p>
                    Unser Team vervollständigt deine Zuordnung. Danach erscheint
                    hier dein Training.
                  </p>
                </div>
              ) : (
                <>
                  {(section === "" || section === "stempelkarte") && (
                    <>
                      <section className="membership-strip">
                        <div className="membership-icon">
                          <Zap size={22} fill="currentColor" />
                        </div>
                        <div className="membership-plan">
                          <small>DEIN TRAININGSPAKET</small>
                          <strong>
                            {period?.product_name ?? "Noch kein aktives Paket"}{" "}
                            <Badge tone="lime">
                              <span className="status-dot" />
                              {(
                                {
                                  active: "Aktiv",
                                  trialing: "Testphase",
                                  past_due: "Zahlung offen",
                                  canceled: "Gekündigt",
                                  unpaid: "Nicht bezahlt",
                                  incomplete: "Unvollständig",
                                  paused: "Pausiert",
                                } as Record<string, string>
                              )[
                                period?.subscription_status ??
                                  period?.status ??
                                  ""
                              ] ?? "Offen"}
                            </Badge>
                          </strong>
                        </div>
                        <div className="membership-period">
                          {periods.length > 1 && (
                            <select
                              aria-label="Paket und Leistungszeitraum auswählen"
                              value={period?.id ?? ""}
                              onChange={(e) =>
                                setSelectedPeriod(e.target.value)
                              }
                            >
                              {periods.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.product_name} ·{" "}
                                  {periodLabel(p.starts_at, p.ends_at)}
                                </option>
                              ))}
                            </select>
                          )}
                          <span>Persönlicher Leistungszeitraum</span>
                          <b>
                            {period
                              ? periodLabel(period.starts_at, period.ends_at)
                              : "Noch nicht zugeordnet"}
                          </b>
                        </div>
                        <Link className="text-button" href="/konto">
                          Abo verwalten <ArrowUpRight size={17} />
                        </Link>
                      </section>
                      <section className="stats-grid">
                        <Stat
                          icon={<CheckCheck />}
                          title="Angerechnete Einheiten"
                          value={String(stats.completed)}
                          suffix={`/ ${period?.included_units ?? 0}`}
                          note="in diesem Leistungszeitraum"
                          color="lime"
                        />
                        <Stat
                          icon={<CalendarDays />}
                          title="Geplante Einheiten"
                          value={String(stats.planned)}
                          note="die nächsten Schritte stehen"
                          color="purple"
                        />
                        <Stat
                          icon={<Timer />}
                          title="Trainingszeit"
                          value={String(Math.floor(stats.minutes / 60))}
                          suffix={`Std. ${stats.minutes % 60} Min.`}
                          note="absolviertes Training in diesem Zeitraum"
                          color="dark"
                        />
                      </section>
                    </>
                  )}
                  {section === "" && (
                    <div className="dashboard-grid">
                      <section className="panel stamp-panel">
                        <div className="panel-heading">
                          <h2>Deine Stempelkarte</h2>
                          <span className="subtle-label">
                            {period?.product_name}
                          </span>
                        </div>
                        <div className="stamp-caption">
                          <b>
                            {stats.completed} von {period?.included_units ?? 0}{" "}
                            Einheiten angerechnet
                          </b>
                          <span>Jede Einheit zählt.</span>
                        </div>
                        <Stamps
                          period={period}
                          completed={stats.completed}
                          charged={stats.charged}
                          retrospective={stats.retrospective}
                          planned={stats.planned}
                          splitStats={splitStats}
                        />
                        <StampLegend />
                        <ExcusedNotes events={rows} />
                        <BackfillNotes events={rows} />
                        <div className="panel-bottom">
                          <span>
                            {stats.neutral > 0
                              ? `${stats.neutral} ${stats.neutral === 1 ? "Termin ohne Anrechnung" : "Termine ohne Anrechnung"}`
                              : "Dein Fortschritt wird automatisch aktualisiert."}
                          </span>
                          <Link href="/stempelkarte">
                            Details ansehen <ArrowRight size={16} />
                          </Link>
                        </div>
                      </section>
                      <section className="next-panel">
                        <div className="next-top">
                          <span>
                            <span className="status-dot" /> ALS NÄCHSTES
                          </span>
                          <CalendarDays size={20} />
                        </div>
                        {upcoming[0] ? (
                          <>
                            <div className="next-date">
                              {formatDate(upcoming[0].starts_at, {
                                weekday: "long",
                                day: "2-digit",
                                month: "long",
                              })}
                            </div>
                            <h2>
                              {formatTime(upcoming[0].starts_at)}{" "}
                              <span>– {formatTime(upcoming[0].ends_at)}</span>
                            </h2>
                            <p className="next-title">{upcoming[0].title}</p>
                            <div className="next-meta">
                              <span>
                                <MapPin size={17} />
                                {upcoming[0].location_name}
                              </span>
                              <span>
                                <UserRound size={17} />
                                {upcoming[0].trainer_name}
                              </span>
                            </div>
                            <button onClick={() => setDetail(upcoming[0])}>
                              Termindetails <ArrowUpRight size={18} />
                            </button>
                          </>
                        ) : (
                          <div className="empty-dark">
                            <h2>Bereit für den nächsten Schritt.</h2>
                            <p>
                              Dein nächstes Training erscheint hier, sobald
                              unser Team es plant.
                            </p>
                          </div>
                        )}
                      </section>
                    </div>
                  )}
                  {section === "stempelkarte" && (
                    <section className="panel large-stamp">
                      <div className="panel-heading">
                        <h2>
                          {period?.product_name ?? "Trainingsfortschritt"}
                        </h2>
                        <select
                          aria-label="Leistungszeitraum auswählen"
                          value={period?.id ?? ""}
                          onChange={(e) => setSelectedPeriod(e.target.value)}
                        >
                          {periods.map((p) => (
                            <option key={p.id} value={p.id}>
                              {periodLabel(p.starts_at, p.ends_at)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <Stamps
                        period={period}
                        completed={stats.completed}
                        charged={stats.charged}
                        retrospective={stats.retrospective}
                        planned={stats.planned}
                        splitStats={splitStats}
                      />
                      <StampLegend />
                      <ExcusedNotes events={rows} />
                      <BackfillNotes events={rows} />
                      <p>
                        {stats.completed} von {period?.included_units ?? 0}{" "}
                        Einheiten angerechnet · {durationLabel(stats.minutes)}
                      </p>
                      {stats.completed > (period?.included_units ?? 0) && (
                        <p>
                          Über dem aktuellen Kontingent:{" "}
                          {stats.completed - (period?.included_units ?? 0)}{" "}
                          Einheiten.
                        </p>
                      )}
                    </section>
                  )}
                  {(section === "" || section === "termine") && (
                    <Schedule
                      events={section === "" ? past.slice(0, 3) : events}
                      playerId={player.id}
                      title={
                        section === ""
                          ? "Zuletzt auf dem Platz"
                          : "Dein Trainingskalender"
                      }
                      open={setDetail}
                      full={section === "termine"}
                    />
                  )}
                  {section === "" && (
                    <div className="bottom-grid">
                      <div className="report-teaser">
                        <div className="report-icon">
                          <FileText size={24} />
                        </div>
                        <div>
                          <h3>Dein Fortschritt. Zum Mitnehmen.</h3>
                          <p>Alle Trainingsberichte an einem Ort.</p>
                        </div>
                        <Link href="/berichte" className="text-button">
                          Berichte ansehen <ArrowRight size={17} />
                        </Link>
                      </div>
                      <div className="secure-note">
                        <ShieldCheck size={19} />
                        <span>
                          Deine Daten bleiben in deiner Familie.
                          <br />
                          Sicher und nur für dich und unser Team.
                        </span>
                      </div>
                    </div>
                  )}
                  {section === "berichte" && (
                    <section className="reports-list">
                      {reports.length ? (
                        reports.map((r) => (
                          <article className="report-card panel" key={r.id}>
                            <div className="report-cover">
                              <FileText size={44} />
                              <span>TRAININGSREPORT</span>
                              <b>{r.product_name}</b>
                              <Image
                                src="/brand/logo-neon.png"
                                alt="ProAcademy"
                                width={38}
                                height={45}
                                unoptimized
                              />
                            </div>
                            <div className="report-info">
                              <Badge>Version {r.version}</Badge>
                              <h2>{r.period_label}</h2>
                              <p>
                                {r.completed} von {r.units} Einheiten ·{" "}
                                {durationLabel(r.minutes)}
                              </p>
                              {(r.athletics_units ?? 0) > 0 && (
                                <p>
                                  Fußball {r.football_completed ?? 0} /{" "}
                                  {r.units - r.athletics_units!} · Athletik{" "}
                                  {r.athletics_completed ?? 0} /{" "}
                                  {r.athletics_units}
                                </p>
                              )}
                              <span className="muted">
                                Erstellt am {formatDate(r.created_at)}
                              </span>
                              <a
                                className="primary-button"
                                href={`/api/reports/${r.id}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <Download size={17} /> PDF herunterladen
                              </a>
                            </div>
                          </article>
                        ))
                      ) : (
                        <div className="empty-state">
                          <FileText />
                          <h2>Dein erster Bericht kommt bald.</h2>
                          <p>
                            Nach Ende deines persönlichen Leistungszeitraums
                            erscheint er hier.
                          </p>
                        </div>
                      )}
                      <div className="info-note">
                        <Info size={19} />
                        <p>
                          Berichte zeigen den Datenstand zum
                          Erstellungszeitpunkt. Noch nicht bestätigte Einheiten
                          sind als „Prüfung ausstehend“ gekennzeichnet.
                        </p>
                      </div>
                    </section>
                  )}
                  {section === "konto" && (
                    <div className="account-grid">
                      <EmailPreference email={data.email} notify={setToast} />
                      <section className="panel account-panel">
                        <h2>Dein Elternkonto</h2>
                        <div className="account-person">
                          <span className="avatar child-avatar">
                            {data.user_name.charAt(0)}
                          </span>
                          <div>
                            <b>{data.user_name}</b>
                            <p>{data.email}</p>
                          </div>
                        </div>
                        <h3>Deine Kinder</h3>
                        {data.players.map((p) => (
                          <div className="account-row" key={p.id}>
                            <UserRound size={18} />
                            <b>
                              {p.first_name} {p.last_name}
                            </b>
                            {p.team && <Badge>{p.team}</Badge>}
                          </div>
                        ))}
                        <p className="muted">
                          Deine Kontaktdaten oder Zuordnungen haben sich
                          geändert? Unser Team hilft dir weiter.
                        </p>
                        <a
                          className="secondary-button"
                          href={`https://wa.me/${data.whatsapp}`}
                        >
                          <MessageCircle size={18} /> Team kontaktieren
                        </a>
                      </section>
                      <section className="panel account-panel">
                        <h2>Abonnement & Rechnungen</h2>
                        {periods.map((p) => (
                          <div className="account-row" key={p.id}>
                            <Zap size={18} />
                            <div>
                              <b>{p.product_name}</b>
                              <p>{periodLabel(p.starts_at, p.ends_at)}</p>
                            </div>
                            <Badge tone="lime">{p.status}</Badge>
                          </div>
                        ))}
                        <p>
                          Rechnungen, Rechnungsadresse und Zahlungsmethode
                          verwaltest du sicher über Stripe.
                        </p>
                        <div className="billing-account-actions">
                          {(data.billing_customers?.length
                            ? data.billing_customers
                            : [{ stripe_customer_id: "" }]
                          ).map((account, index) => {
                            const customerId = account.stripe_customer_id;
                            const childIds = new Set(
                              data.periods
                                .filter(
                                  (p) => p.stripe_customer_id === customerId,
                                )
                                .map((p) => p.player_id),
                            );
                            const names = data.players
                              .filter((p) => childIds.has(p.id))
                              .map((p) => p.first_name)
                              .join(" und ");
                            return (
                              <button
                                key={customerId || "billing"}
                                className="primary-button"
                                onClick={() =>
                                  openBilling(customerId || undefined)
                                }
                              >
                                {data.billing_customers &&
                                data.billing_customers.length > 1
                                  ? names
                                    ? `Abo für ${names} verwalten`
                                    : `Abokonto ${index + 1} verwalten`
                                  : "Stripe-Kundenportal öffnen"}{" "}
                                <ArrowUpRight size={17} />
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    </div>
                  )}
                </>
              )}
            </>
          )}
          {section === "konto" && (
            <button
              className="secondary-button"
              onClick={async () => {
                try {
                  await flushEmailPreference();
                } catch {
                  setToast(
                    "E-Mail-Einstellung konnte nicht gespeichert werden. Bitte vor dem Abmelden erneut versuchen.",
                  );
                  return;
                }
                const res = await fetch("/api/auth/logout", { method: "POST" });
                if (res.ok) window.location.assign("/login");
                else
                  setToast("Abmeldung fehlgeschlagen. Bitte erneut versuchen.");
              }}
            >
              <LogOut size={17} />
              {"Sicher abmelden"}
            </button>
          )}
          {paiVisible && <PaiLauncher role={data.role} />}
          <footer className="content-footer">
            <span>© 2026 ProAcademy by Ayhan & Karaman</span>
            <div>
              <a
                href="https://proacademy-ak.com/datenschutz"
                target="_blank"
                rel="noreferrer"
              >
                Datenschutz
              </a>
              <span>Europe/Berlin</span>
            </div>
          </footer>
        </main>
      </div>
      {detail && (
        <EventDetail
          event={detail}
          data={data}
          playerId={player?.id ?? ""}
          close={() => setDetail(null)}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Info size={20} />
          <span>{toast}</span>
          <button
            className="icon-button"
            onClick={() => setToast("")}
            aria-label="Hinweis schließen"
          >
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
function Stat({
  icon,
  title,
  value,
  suffix,
  note,
  color,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  suffix?: string;
  note: string;
  color: string;
}) {
  return (
    <article className="stat-card">
      <div className="stat-label">
        <span>{title}</span>
        <span className={`stat-icon ${color}`}>{icon}</span>
      </div>
      <div className="stat-value">
        {value} <span>{suffix}</span>
      </div>
      <p>{note}</p>
    </article>
  );
}
export function Stamps({
  period,
  completed,
  planned,
  splitStats,
  charged = 0,
  retrospective = 0,
  onOpenStamp,
}: {
  period?: Period;
  completed: number;
  planned: number;
  charged?: number;
  retrospective?: number;
  onOpenStamp?: (discipline: "football" | "athletics") => void;
  splitStats?: ReturnType<typeof disciplineStats>;
}) {
  if ((period?.athletics_units ?? 0) > 0 && splitStats) {
    return (
      <div className="discipline-stamps">
        {(["football", "athletics"] as const).map((discipline) => {
          const units =
            discipline === "athletics"
              ? period!.athletics_units!
              : period!.included_units - period!.athletics_units!;
          const stats = splitStats[discipline];
          return (
            <section key={discipline}>
              <h3>
                {discipline === "athletics" ? "Athletik" : "Fußball"} ·{" "}
                {stats.completed} / {units}
              </h3>
              <Stamps
                period={{
                  ...period!,
                  included_units: units,
                  athletics_units: 0,
                }}
                completed={stats.completed}
                charged={stats.charged}
                retrospective={stats.retrospective}
                planned={stats.planned}
                onOpenStamp={
                  onOpenStamp ? () => onOpenStamp(discipline) : undefined
                }
              />
              {stats.completed > units && (
                <p>Über dem aktuellen Kontingent: {stats.completed - units}</p>
              )}
            </section>
          );
        })}
      </div>
    );
  }
  return (
    <div className="stamps">
      {stampSlots(
        Math.max(period?.included_units ?? 0, completed),
        completed,
        planned,
        charged,
        retrospective,
      ).map((state, i) => (
        <div className="stamp-item" key={i}>
          <div
            className={`stamp ${state} ${i >= (period?.included_units ?? 0) ? "over-quota" : ""}`}
            aria-label={`Einheit ${i + 1}${i >= (period?.included_units ?? 0) ? " über Kontingent" : ""}: ${state === "done" ? "absolviert" : state === "retrospective" ? "nachgetragen" : state === "charged" ? "angerechnet, abgesagt oder nicht erschienen" : state === "planned" ? "geplant" : "offen"}`}
          >
            {state === "charged" || state === "retrospective" ? (
              <span>OK</span>
            ) : state === "done" ? (
              <Check size={25} strokeWidth={2.6} />
            ) : state === "planned" ? (
              <Clock size={23} />
            ) : onOpenStamp ? (
              <button
                type="button"
                className="stamp-add"
                aria-label={`Einheit ${i + 1} nachtragen`}
                onClick={() => onOpenStamp("football")}
              >
                <span>{String(i + 1).padStart(2, "0")}</span>
                <small>Nachtragen</small>
              </button>
            ) : (
              <span>{String(i + 1).padStart(2, "0")}</span>
            )}
          </div>
          <small>
            {i >= (period?.included_units ?? 0)
              ? "Über Kontingent"
              : `Einheit ${i + 1}`}
          </small>
        </div>
      ))}
    </div>
  );
}
export function StampLegend() {
  return (
    <div className="stamp-legend">
      <span>
        <i className="legend-dot lime" />
        Absolviert
      </span>
      <span>
        <i className="legend-dot amber" />
        Nachgetragen (OK)
      </span>
      <span>
        <i className="legend-dot red" />
        Angerechnet (Absage)
      </span>
      <span>
        <i className="legend-dot purple" />
        Geplant
      </span>
      <span>
        <i className="legend-dot outline" />
        Noch offen
      </span>
    </div>
  );
}
function Schedule({
  events,
  playerId,
  title,
  open,
  full,
}: {
  events: Training[];
  playerId: string;
  title: string;
  open: (event: Training) => void;
  full: boolean;
}) {
  const [filter, setFilter] = useState("all");
  const filtered = events
    .filter(
      (e) =>
        filter === "all" ||
        (filter === "planned"
          ? e.participants.find((p) => p.player_id === playerId)?.status ===
            "planned"
          : e.participants.find((p) => p.player_id === playerId)?.status !==
            "planned"),
    )
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  return (
    <section className="panel schedule-panel">
      <div className="panel-heading">
        <h2>{title}</h2>
        {full ? (
          <div className="segmented">
            {[
              ["all", "Alle"],
              ["planned", "Geplant"],
              ["past", "Vergangen"],
            ].map(([v, t]) => (
              <button
                className={filter === v ? "selected" : ""}
                key={v}
                onClick={() => setFilter(v)}
              >
                {t}
              </button>
            ))}
          </div>
        ) : (
          <Link href="/termine" className="text-button">
            Alle Termine <ArrowRight size={16} />
          </Link>
        )}
      </div>
      <div className="table-scroll">
        <table className="training-table">
          <thead>
            <tr>
              <th>DATUM & UHRZEIT</th>
              <th>TRAINING</th>
              <th>STANDORT</th>
              <th>STATUS</th>
              <th>
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => {
              const status = e.participants.find(
                (p) => p.player_id === playerId,
              )!.status;
              return (
                <tr key={e.id} onClick={() => open(e)}>
                  <td>
                    <div className="date-cell">
                      <div className="date-box">
                        <strong>
                          {formatDate(e.starts_at, { day: "2-digit" })}
                        </strong>
                        <span>
                          {formatDate(e.starts_at, { month: "short" })
                            .replace(".", "")
                            .toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <b>{formatDate(e.starts_at, { weekday: "long" })}</b>
                        <small>
                          {formatTime(e.starts_at)} – {formatTime(e.ends_at)}{" "}
                          Uhr
                        </small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <b>{e.title}</b>
                    <small>
                      {e.trainer_name} ·{" "}
                      {durationMinutes(e.starts_at, e.ends_at)} Min.
                    </small>
                  </td>
                  <td>
                    <span className="location-cell">
                      <MapPin size={15} />
                      {e.location_name}
                    </span>
                  </td>
                  <td>
                    <Badge
                      tone={
                        isChargedAbsence(status)
                          ? "danger"
                          : isAttended(status)
                            ? "success"
                            : status === "planned"
                              ? "purple"
                              : "neutral"
                      }
                    >
                      {isAttended(status) ? (
                        <Check size={13} />
                      ) : status === "planned" ? (
                        <Clock size={13} />
                      ) : null}
                      {e.status === "cancelled"
                        ? "Teamabsage · ohne Anrechnung"
                        : STATUS_LABELS[status]}
                    </Badge>
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        open(e);
                      }}
                      aria-label={`Details ${e.title} ${formatDate(e.starts_at)}`}
                    >
                      <ArrowUpRight size={18} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!filtered.length && (
          <div className="empty-state">
            <CalendarDays />
            <p>Hier sind noch keine Termine eingetragen.</p>
          </div>
        )}
      </div>
    </section>
  );
}
export function Modal({
  title,
  active = true,
  close,
  children,
}: {
  title: string;
  active?: boolean;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null),
    onClose = useRef(close);
  onClose.current = close;
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current
      ?.querySelector<HTMLElement>("button")
      ?.focus({ preventScroll: true });
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose.current();
      }
      if (e.key === "Tab") {
        const items = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
          ) ?? [],
        );
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = old;
      previous?.focus({ preventScroll: true });
    };
  }, [active]);
  return createPortal(
    <div
      className="modal-backdrop"
      hidden={!active}
      inert={!active}
      style={active ? undefined : { display: "none" }}
      onClick={close}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className="modal"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            onClick={close}
            aria-label="Dialog schließen"
          >
            <X size={22} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
function EventDetail({
  event,
  data,
  playerId,
  close,
}: {
  event: Training;
  data: PortalData;
  playerId: string;
  close: () => void;
}) {
  const p = data.players.find((p) => p.id === playerId);
  const status =
    event.participants.find((p) => p.player_id === playerId)?.status ??
    "planned";
  return (
    <Modal title="Dein Training" close={close}>
      <div className="event-detail">
        <Badge
          tone={
            isChargedAbsence(status)
              ? "danger"
              : isAttended(status)
                ? "success"
                : "purple"
          }
        >
          {event.status === "cancelled"
            ? "Teamabsage · ohne Anrechnung"
            : STATUS_LABELS[status]}
        </Badge>
        <h3>{event.title}</h3>
        <div className="detail-row">
          <CalendarDays />
          {formatDate(event.starts_at, {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </div>
        <div className="detail-row">
          <Clock />
          {formatTime(event.starts_at)} – {formatTime(event.ends_at)} Uhr
        </div>
        <div className="detail-row">
          <MapPin />
          <span>
            {event.location_name}
            <small>{event.address}</small>
          </span>
        </div>
        <div className="detail-row">
          <UserRound />
          {event.trainer_name}
        </div>
        <div className="info-note">
          <Info size={20} />
          <p>
            Änderungen oder Stornierungen sind aktuell nur über unser Team
            möglich. Bitte kontaktiere uns per WhatsApp.
          </p>
        </div>
        <a
          className="primary-button"
          href={whatsappLink(
            data.whatsapp,
            p?.first_name ?? "",
            event.starts_at,
            event.id,
            isAttended(status),
          )}
          target="_blank"
          rel="noreferrer"
        >
          <MessageCircle size={18} /> Team per WhatsApp kontaktieren{" "}
          <ArrowUpRight size={17} />
        </a>
        <p className="muted">Termin-ID: {event.id}</p>
      </div>
    </Modal>
  );
}
