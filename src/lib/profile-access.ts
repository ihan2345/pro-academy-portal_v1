export type ProfileAccess = {
  activated: boolean;
  signed_in: boolean;
  last_seen_at: string | null;
  /**
   * Nicht freigeschaltet, aber ein Login-Konto mit dieser E-Mail hat sich
   * schon eingeloggt (letzter Login). Fehlt, wenn unbekannt oder freigeschaltet.
   */
  signed_up_at?: string | null;
  complete: boolean;
  invitation: {
    status:
      | "none"
      | "created"
      | "queued"
      | "held"
      | "sent"
      | "accepted"
      | "expired"
      | "failed"
      | "uncertain"
      | "unknown";
    kind: "invitation" | "access_link";
    sent_at: string | null;
    accepted_at: string | null;
  };
};
export function accessLabel(access: ProfileAccess) {
  return access.activated && access.signed_in
    ? "Bereits angemeldet"
    : access.activated
      ? "Zugang aktiviert"
      : access.signed_up_at
        ? "Angemeldet, noch nicht freigeschaltet"
        : "Noch nicht angemeldet";
}
export function invitationLabel(access: ProfileAccess) {
  const name =
    access.invitation.kind === "access_link" ? "Zugangslink" : "Einladung";
  return {
    none: "Noch keine Einladung",
    created: `${name} erstellt`,
    queued: `${name} zum Versand eingeplant`,
    held: `${name} vorgemerkt`,
    sent: `${name} gesendet`,
    accepted: `${name} angenommen`,
    expired: `${name} abgelaufen`,
    failed: `${name}: Versand fehlgeschlagen`,
    uncertain: `${name}: Versand nicht bestätigt`,
    unknown: "Einladungsstatus nicht verfügbar",
  }[access.invitation.status];
}
export function profileAccess(input: {
  activated: boolean;
  lastSeen?: string | null;
  invitations: {
    created_at: string;
    expires_at: string;
    consumed_at?: string | null;
    status?: string;
    sent_at?: string | null;
    sent_confirmed?: boolean;
  }[];
  guestMessages: {
    created_at: string;
    status: string;
    sent_at?: string | null;
  }[];
  claimedAt?: string | null;
  now: string;
}): ProfileAccess {
  const accepted = input.invitations
    .filter((i) => i.consumed_at)
    .sort((a, b) => b.consumed_at!.localeCompare(a.consumed_at!))[0];
  const access: ProfileAccess = {
    activated: input.activated,
    signed_in: !!input.lastSeen || !!input.claimedAt || !!accepted,
    last_seen_at: input.lastSeen ?? null,
    complete: true,
    invitation: {
      status: "none",
      kind: "invitation",
      sent_at: null,
      accepted_at: null,
    },
  };
  if (accepted || input.claimedAt) {
    const guest =
      !!input.claimedAt &&
      (!accepted || input.claimedAt > accepted.consumed_at!);
    access.invitation = {
      status: "accepted",
      kind: guest ? "access_link" : "invitation",
      accepted_at: guest ? input.claimedAt! : accepted.consumed_at!,
      sent_at: guest
        ? (input.guestMessages
            .filter((m) => m.sent_at)
            .map((m) => m.sent_at!)
            .sort()
            .at(-1) ?? null)
        : (accepted.sent_at ?? null),
    };
    return access;
  }
  const latestInvite = [...input.invitations].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  )[0];
  const latestGuest = [...input.guestMessages].sort((a, b) =>
    (b.sent_at ?? b.created_at).localeCompare(a.sent_at ?? a.created_at),
  )[0];
  if (
    latestGuest &&
    (!latestInvite ||
      (latestGuest.sent_at ?? latestGuest.created_at) > latestInvite.created_at)
  ) {
    access.invitation = {
      status:
        latestGuest.status === "sent" && latestGuest.sent_at
          ? "sent"
          : latestGuest.status === "failed"
            ? "failed"
            : latestGuest.status === "uncertain"
              ? "uncertain"
              : "queued",
      kind: "access_link",
      sent_at: latestGuest.sent_at ?? null,
      accepted_at: null,
    };
  } else if (latestInvite) {
    access.invitation = {
      status:
        latestInvite.expires_at <= input.now
          ? "expired"
          : latestInvite.sent_confirmed
            ? "sent"
            : latestInvite.status === "sent" ||
                latestInvite.status === "uncertain"
              ? "uncertain"
              : latestInvite.status === "failed"
                ? "failed"
                : latestInvite.status === "held"
                  ? "held"
                  : ["pending", "processing"].includes(
                        latestInvite.status ?? "",
                      )
                    ? "queued"
                    : "created",
      kind: "invitation",
      sent_at: latestInvite.sent_confirmed
        ? (latestInvite.sent_at ?? null)
        : null,
      accepted_at: null,
    };
  }
  return access;
}
