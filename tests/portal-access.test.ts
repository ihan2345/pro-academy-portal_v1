import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  canOpenPortalSection,
  portalHome,
  type PortalRole,
} from "../src/lib/portal-access";
import { portalFixture } from "./fixtures/portal";
import { Portal } from "../src/components/portal";
import { loadPortal } from "../src/lib/server/data";

const auth = vi.hoisted(() => ({ session: vi.fn(), from: vi.fn() }));
vi.mock("../src/lib/server/supabase", () => ({ sessionUser: auth.session }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  redirect: (url: string) => {
    throw new Error("redirect:" + url);
  },
}));

beforeEach(() => vi.clearAllMocks());

const cases: [PortalRole, string, string[]][] = [
  ["parent", "", ["team", "admin", "admin/trainingsplanung"]],
  ["staff", "team", ["", "berichte", "admin", "admin/spieler"]],
  ["admin", "admin", ["", "team", "termine", "stempelkarte"]],
];

describe.each(cases)(
  "Portalbereich für %s",
  (role, ownSection, foreignSections) => {
    it("erlaubt den eigenen Bereich und das persönliche Konto", () => {
      expect(canOpenPortalSection(role, ownSection)).toBe(true);
      expect(canOpenPortalSection(role, "konto")).toBe(true);
    });
    it.each(foreignSections)(
      "leitet /%s vor einer Datenabfrage zum eigenen Bereich um",
      async (section) => {
        auth.session.mockResolvedValue({ role, db: { from: auth.from } });
        await expect(loadPortal(section)).rejects.toThrow(
          "redirect:" + portalHome(role),
        );
        expect(auth.from).not.toHaveBeenCalled();
      },
    );
    it.each([ownSection, "konto"])(
      "zeigt auf /%s keine Links in fremde Portale",
      (section) => {
        const html = renderToStaticMarkup(
          createElement(Portal, {
            initial: { ...portalFixture, role },
            section,
          }),
        );
        const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(
          (match) => match[1],
        );
        expect(hrefs).toContain(portalHome(role));
        for (const href of hrefs.filter(
          (value) => value.startsWith("/") && !value.startsWith("//"),
        )) {
          expect(canOpenPortalSection(role, href.slice(1)), href).toBe(true);
        }
        expect(html).not.toMatch(/>Eltern<|>Mitarbeiter<\/a>|>Admin<\/a>/);
      },
    );
  },
);

it("erhält die Admin-Trainingsplanung im eigenen Bereich", () => {
  expect(canOpenPortalSection("admin", "admin/trainingsplanung")).toBe(true);
});

it("leitet nicht angemeldete Nutzer weiterhin zur Anmeldung", async () => {
  auth.session.mockResolvedValue(null);
  await expect(loadPortal("admin")).rejects.toThrow("redirect:/login");
  expect(auth.from).not.toHaveBeenCalled();
});

it("keeps team stamp cards in the correct role navigation", () => {
  expect(canOpenPortalSection("staff", "team/stempelkarten")).toBe(true);
  expect(canOpenPortalSection("admin", "admin/stempelkarten")).toBe(true);
  expect(canOpenPortalSection("parent", "team/stempelkarten")).toBe(false);
  expect(canOpenPortalSection("parent", "admin/stempelkarten")).toBe(false);
  expect(canOpenPortalSection("staff", "admin/stempelkarten")).toBe(false);
  expect(canOpenPortalSection("admin", "team/stempelkarten")).toBe(false);
});
