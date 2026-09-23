import { beforeEach, expect, it, vi } from "vitest";
import {
  isV2Unavailable,
  optionalBackfills,
} from "../src/lib/server/v2-availability";
import { loadPortal } from "../src/lib/server/data";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("../src/lib/server/supabase", () => ({ sessionUser: mocks.session }));
vi.mock("../src/lib/camps/guard", () => ({
  campEnabled: () => false,
  campLocalEnabled: () => false,
}));

const missing = {
  code: "PGRST205",
  message:
    "Could not find the table 'public.training_backfills' in the schema cache",
};
beforeEach(() => vi.clearAllMocks());

it("keeps the admin dashboard available before V2 migrations", async () => {
  const player = {
    id: "child",
    first_name: "Test",
    last_name: "Kind",
    team: "U12",
  };
  const from = vi.fn((table: string) => {
    const result =
      table === "training_backfills"
        ? { data: null, error: missing }
        : { data: table === "players" ? [player] : [], error: null };
    const chain: any = {
      select: () => chain,
      is: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      then: (resolve: any, reject: any) =>
        Promise.resolve(result).then(resolve, reject),
    };
    return chain;
  });
  mocks.session.mockResolvedValue({
    role: "admin",
    name: "Test Admin",
    user: { email: "admin@example.invalid" },
    db: { from },
  });
  const data = await loadPortal("admin");
  expect(data.players).toEqual([player]);
  expect(data.backfills).toEqual([]);
  expect(data.role).toBe("admin");
});
it.each([
  missing,
  {
    code: "42P01",
    message: 'relation "public.training_backfills" does not exist',
  },
])("recognizes only an absent backfill table: $code", async (error) => {
  expect(
    await optionalBackfills(Promise.resolve({ data: null, error })),
  ).toEqual({ data: [], error: null, available: false });
  expect(await optionalBackfills(Promise.reject(error))).toEqual({
    data: [],
    error: null,
    available: false,
  });
});
it.each([
  { code: "42501", message: "permission denied for table training_backfills" },
  {
    code: "PGRST205",
    message:
      "Could not find the table 'public.training_backfill_private_notes'",
  },
  { code: "PGRST200", message: "Missing relationship for training_backfills" },
  { code: "PGRST205", message: "Could not find the table 'public.players'" },
  { message: "Network error" },
])("does not hide unrelated errors: $message", async (error) => {
  await expect(
    optionalBackfills(Promise.resolve({ data: null, error })),
  ).rejects.toBe(error);
});
it("returns installed backfills including an empty installed table as available", async () => {
  for (const data of [[], [{ id: "backfill" }]]) {
    expect(
      await optionalBackfills(Promise.resolve({ data, error: null })),
    ).toEqual({ data, error: null, available: true });
  }
});
it("identifies only missing V2 tables/functions as an unavailable feature", () => {
  expect(
    isV2Unavailable({
      code: "PGRST202",
      message:
        "Could not find the function public.save_training_backfill(input)",
    }),
  ).toBe(true);
  expect(
    isV2Unavailable({
      code: "PGRST205",
      message: "Could not find the table 'public.stripe_customer_registry'",
    }),
  ).toBe(true);
  expect(
    isV2Unavailable({
      code: "42501",
      message: "permission denied for table stripe_customer_registry",
    }),
  ).toBe(false);
});
