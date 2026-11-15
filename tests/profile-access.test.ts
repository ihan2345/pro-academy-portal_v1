import { expect, it } from "vitest";
import {
  profileAccess,
  accessLabel,
  invitationLabel,
} from "../src/lib/profile-access";
const base = {
  activated: false,
  invitations: [],
  guestMessages: [],
  now: "2026-11-15T12:00:00Z",
};
const invite = {
  created_at: "2026-11-10T12:00:00Z",
  expires_at: "2026-11-17T12:00:00Z",
};
it("distinguishes an unactivated customer, activated access, and an evidenced login", () => {
  expect(accessLabel(profileAccess(base))).toBe("Noch nicht angemeldet");
  expect(accessLabel(profileAccess({ ...base, activated: true }))).toBe(
    "Zugang aktiviert",
  );
  expect(
    accessLabel(
      profileAccess({ ...base, activated: true, lastSeen: base.now }),
    ),
  ).toBe("Bereits angemeldet");
});
it.each(["pending", "processing", "held", "failed", "uncertain"])(
  "keeps %s separate from a sent invitation",
  (status) => {
    expect(
      profileAccess({ ...base, invitations: [{ ...invite, status }] })
        .invitation.status,
    ).not.toBe("sent");
  },
);
it("requires confirmed delivery, not an invitation record or capture mail alone", () => {
  expect(
    profileAccess({ ...base, invitations: [invite] }).invitation.status,
  ).toBe("created");
  expect(
    profileAccess({
      ...base,
      invitations: [{ ...invite, status: "sent", sent_confirmed: false }],
    }).invitation.status,
  ).toBe("uncertain");
  expect(
    profileAccess({
      ...base,
      invitations: [
        { ...invite, sent_confirmed: true, sent_at: invite.created_at },
      ],
    }).invitation.status,
  ).toBe("sent");
});
it("recognizes accepted and expired invitations independently of account linkage", () => {
  const accepted = profileAccess({
    ...base,
    activated: true,
    invitations: [{ ...invite, consumed_at: "2026-11-11T12:00:00Z" }],
  });
  expect(accepted.invitation.status).toBe("accepted");
  expect(accessLabel(accepted)).toBe("Bereits angemeldet");
  expect(
    profileAccess({
      ...base,
      invitations: [{ ...invite, expires_at: "2026-11-12T12:00:00Z" }],
    }).invitation.status,
  ).toBe("expired");
});
it("tracks camp guest access emails and claims, without calling every guest a registered user", () => {
  const guestMessages = [
    {
      status: "sent",
      created_at: invite.created_at,
      sent_at: "2026-11-11T12:00:00Z",
    },
  ];
  const sent = profileAccess({ ...base, guestMessages });
  expect(invitationLabel(sent)).toBe("Zugangslink gesendet");
  expect(accessLabel(sent)).toBe("Noch nicht angemeldet");
  expect(
    profileAccess({
      ...base,
      activated: true,
      guestMessages,
      claimedAt: "2026-11-12T12:00:00Z",
    }).invitation.status,
  ).toBe("accepted");
});
