import { beforeEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { portalFixture } from "./fixtures/portal";
import {
  canOpenPortalSection,
  portalHome,
  type PortalRole,
} from "../src/lib/portal-access";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  portal: vi.fn(),
  enabled: true,
}));
vi.mock("../src/lib/server/supabase", () => ({ sessionUser: mocks.session }));
vi.mock("../src/lib/server/data", () => ({ loadPortal: mocks.portal }));
vi.mock("../src/lib/server/products/runtime", () => ({
  productShopEnabled: async () => mocks.enabled,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw Error("not found");
  },
}));
import ProductsPage from "../src/app/produkte/page";
import { ProductStore } from "../src/components/products/store";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = true;
  mocks.session.mockResolvedValue(null);
});
it.each(["parent", "staff", "admin"] as PortalRole[])(
  "keeps %s inside their own portal and links directly to their overview",
  async (role) => {
    mocks.session.mockResolvedValue({ role });
    mocks.portal.mockResolvedValue({
      ...portalFixture,
      role,
      products_enabled: true,
    });
    const html = renderToStaticMarkup(await ProductsPage());
    expect(mocks.portal).toHaveBeenCalledWith("produkte");
    expect(canOpenPortalSection(role, "produkte")).toBe(true);
    expect(html).toContain('id="portal-sidebar"');
    expect(html).toMatch(
      new RegExp(`href="${portalHome(role)}"[^>]*>Überblick`),
    );
    const activeShop = [...html.matchAll(/<a\b[^>]*>/g)]
      .map((m) => m[0])
      .find(
        (tag) =>
          tag.includes('href="/produkte') &&
          tag.includes('aria-current="page"'),
      );
    expect(activeShop).toContain(
      'aria-label="' + (role === "parent" ? "Produkte" : "Shop") + '"',
    );
    expect(html).not.toContain('href="/login"');
    expect(html).not.toContain('class="product-store-nav"');
    expect(html).not.toContain("Mehr Möglichkeiten.");
    expect((html.match(/<main(?:\s|>)/g) ?? []).length).toBe(1);
  },
);
it("keeps the public shop and registration entry available to visitors", async () => {
  const html = renderToStaticMarkup(await ProductsPage());
  expect(mocks.portal).not.toHaveBeenCalled();
  expect(html).not.toContain('id="portal-sidebar"');
  expect(html).toContain('href="/login"');
  expect(html).toContain("Anmelden");
  expect(html).toContain("Mehr Möglichkeiten.");
});
it("keeps confirmed users without a portal role in the family setup flow", async () => {
  mocks.session.mockResolvedValue({ user: { id: "new-signup" } });
  const html = renderToStaticMarkup(await ProductsPage());
  expect(mocks.portal).not.toHaveBeenCalled();
  expect(html).not.toContain('id="portal-sidebar"');
});
it("still checks the Super-Admin shop gate before reading a session", async () => {
  mocks.enabled = false;
  await expect(ProductsPage()).rejects.toThrow("not found");
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.portal).not.toHaveBeenCalled();
});
it.each(["parent", "staff", "admin"] as PortalRole[])(
  "a standalone %s return link also avoids the login page",
  (role) => {
    const html = renderToStaticMarkup(
      createElement(ProductStore, { portalRole: role }),
    );
    expect(html).toMatch(
      new RegExp(`href="${portalHome(role)}"[^>]*>Überblick`),
    );
    expect(html).not.toContain('href="/login"');
    expect(html.includes('href="/profil"')).toBe(role === "parent");
  },
);
