import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../src/app/api/[...path]/route";
const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("../src/lib/server/supabase", () => ({ sessionUser: mocks.session }));
afterEach(() => vi.unstubAllEnvs());

it("shows registration first and counts only invitations actually sent to the parent's current address", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  const parents = [
    "registered",
    "invited",
    "held",
    "capture",
    "redirected",
    "changed",
  ].map((id) => ({
    id,
    auth_user_id: id === "registered" ? "auth-user" : null,
    contact_email: `${id}@example.com`,
    parent_invitations: [{ id: `invite-${id}`, email: `${id}@example.com` }],
    parent_players: id === "registered" ? [{ id: "link" }] : [],
  }));
  const jobs = ["invited", "capture", "redirected", "changed"].map((id) => ({
    payload: { invitation_id: `invite-${id}` },
    recipient: id === "changed" ? "old@example.com" : `${id}@example.com`,
    notification_deliveries: [
      {
        provider: id === "capture" ? "capture" : "proton",
        status: "sent",
        recipient:
          id === "redirected"
            ? "test@example.com"
            : id === "changed"
              ? "old@example.com"
              : `${id}@example.com`,
      },
    ],
  }));
  const from = vi.fn((table: string) => {
    const chain: any = {
      select: () => chain,
      order: () => chain,
      range: () => chain,
      eq: () => chain,
      in: () => chain,
      then: (resolve: (result: unknown) => void) =>
        Promise.resolve({
          data: table === "parents" ? parents : jobs,
          error: null,
        }).then(resolve),
    };
    return chain;
  });
  mocks.session.mockResolvedValue({
    role: "admin",
    user: { id: "admin" },
    db: { from },
  });
  const response = await GET(
    new NextRequest("https://portal.example.com/api/admin/parents"),
    { params: Promise.resolve({ path: ["admin", "parents"] }) },
  );
  expect(response.status).toBe(200);
  const { rows } = await response.json();
  expect(
    rows.map((row: { portal_status: string }) => row.portal_status),
  ).toEqual(["registered", "invited", "none", "none", "none", "none"]);
  expect(rows[0].parent_players).toEqual([{ id: "link" }]);
  expect(rows[0]).not.toHaveProperty("parent_invitations");
});
