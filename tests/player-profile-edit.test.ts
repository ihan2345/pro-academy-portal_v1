import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
}));
vi.mock("../src/lib/server/supabase", () => ({
  sessionUser: mocks.session,
  sessionDb: vi.fn(),
  serviceDb: vi.fn(),
}));
import { POST } from "../src/app/api/[...path]/route";
const id = "12345678-1234-4234-8234-123456789012";
const body = {
  child_id: id,
  first_name: "Kind",
  last_name: "Test",
  birth_year: 2014,
  team: "U13",
  gender: null,
  club: "FC",
  position: "Tor",
  strong_foot: "links",
  height_cm: 150,
  development_goals: "Passen",
};
const context = {
  params: Promise.resolve({ path: ["admin", "player-profile"] }),
};
function request(input: unknown = body, origin = "https://portal.example.com") {
  return new NextRequest(
    "https://portal.example.com/api/admin/player-profile",
    {
      method: "POST",
      headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_URL", "https://portal.example.com");
  mocks.session.mockResolvedValue({
    role: "admin",
    user: { id },
    db: { from: mocks.from },
  });
  mocks.from.mockReturnValue({ update: mocks.update });
  mocks.update.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockReturnValue({ select: mocks.select });
  mocks.select.mockReturnValue({ maybeSingle: mocks.single });
  mocks.single.mockResolvedValue({ data: { id }, error: null });
});
it.each([null, "parent", "staff"])("blocks editing for %s", async (role) => {
  mocks.session.mockResolvedValue(
    role ? { role, user: { id }, db: { from: mocks.from } } : null,
  );
  expect((await POST(request(), context)).status).toBe(role ? 403 : 401);
  expect(mocks.update).not.toHaveBeenCalled();
});
it("updates the selected player without requiring a parent link or altering archive state", async () => {
  expect((await POST(request(), context)).status).toBe(200);
  expect(mocks.from).toHaveBeenCalledWith("players");
  expect(mocks.eq).toHaveBeenCalledWith("id", id);
  const { child_id, ...fields } = body;
  expect(mocks.update).toHaveBeenCalledWith(fields);
});
it("clears optional values and rejects invalid fields or origins", async () => {
  expect(
    (
      await POST(
        request({
          ...body,
          club: "",
          height_cm: null,
          strong_foot: null,
          development_goals: "",
        }),
        context,
      )
    ).status,
  ).toBe(200);
  expect(mocks.update).toHaveBeenCalledWith(
    expect.objectContaining({
      club: null,
      height_cm: null,
      strong_foot: null,
      development_goals: null,
    }),
  );
  mocks.update.mockClear();
  expect((await POST(request({ ...body, height_cm: 999 }), context)).ok).toBe(
    false,
  );
  expect(
    (await POST(request({ ...body, archived_at: null }), context)).ok,
  ).toBe(false);
  expect(
    (await POST(request(body, "https://other.invalid"), context)).status,
  ).toBe(403);
  expect(mocks.update).not.toHaveBeenCalled();
});
it("reports a missing child instead of creating a new record", async () => {
  mocks.single.mockResolvedValue({ data: null, error: null });
  expect((await POST(request(), context)).status).toBe(404);
});
