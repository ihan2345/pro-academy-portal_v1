import { afterEach, beforeEach, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  session: { role: "staff", user: { id: "coach-id" } } as any,
  from: vi.fn(),
  rpc: vi.fn(),
  upsert: vi.fn(),
  prepare: vi.fn(),
  snapshot: {} as any,
}));
vi.mock("../src/lib/server/supabase", () => ({
  sessionUser: async () => f.session,
}));
vi.mock("../src/lib/camps/guard", () => ({
  requireCampAccess: async () => {},
}));
vi.mock("../src/lib/camps/runtime", () => ({
  campLocalEnabled: () => false,
  campPaymentMode: () => "live",
  campAppOrigin: () => "https://example.invalid",
}));
vi.mock("../src/lib/camps/processing-config", () => ({
  campReviewEnabled: () => true,
}));
vi.mock("../src/lib/camps/processing", () => ({
  readServerReview: async () => f.snapshot,
}));
vi.mock("../src/lib/camps/import-core", async (original) => ({
  ...(await original<typeof import("../src/lib/camps/import-core")>()),
  prepareCampImport: f.prepare,
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({ from: f.from, rpc: f.rpc }),
}));
import { campReview, reviewReference } from "../src/lib/camps/local-review";
import { saveCampReview } from "../src/lib/camps/import-review";

const campId = "a0000000-0000-4000-8000-000000000001";
const draft = {
  camp_id: campId,
  payment_id: "pi_paid",
  parent_id: "a0000000-0000-4000-8000-000000000002",
  player_id: "a0000000-0000-4000-8000-000000000003",
  child: {
    first_name: "Test",
    last_name: "Child",
    birth_date: "2015-04-17",
    gender: "keine Angabe",
    clothing_size: "152",
  },
  notes: "Gespeicherter Entwurf",
};
const families = [
  {
    id: draft.parent_id,
    full_name: "Test Parent",
    parent_players: [{ players: { id: draft.player_id } }],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CAMP_STRIPE_READ_KEY", "rk_live_fixture");
  f.session = { role: "staff", user: { id: "coach-id" } };
  f.snapshot = {
    running: true,
    checked_at: new Date().toISOString(),
    interval_seconds: 300,
    error: null,
    sources: [{ camp_id: campId, payment_link_id: "plink_camp" }],
    records: [
      {
        camp_id: campId,
        payment_link_id: "plink_camp",
        session_id: "cs_live_paid",
        payment_id: "pi_paid",
        parent_name: "Test Parent",
        child_name: "Test Child",
        age_at_booking: "11",
        clothing_size: "152",
        amount: 10000,
        currency: "eur",
        status: "paid",
        issues: [],
        created_at: new Date().toISOString(),
      },
    ],
  };
  f.upsert.mockResolvedValue({ error: null });
  f.rpc.mockImplementation(async (name) => ({
    data: name === "camp_occupied_seats" ? 0 : "booking-id",
    error: null,
  }));
  f.prepare.mockImplementation(
    async (_db, _stripe, data, _sessionId, actorId) => ({
      ...data,
      actor_id: actorId,
    }),
  );
  f.from.mockImplementation((table) => {
    const data =
      table === "camps"
        ? { id: campId, payment_mode: "live" }
        : table === "parents"
          ? families
          : table === "camp_review_drafts"
            ? [{ payment_id: "pi_paid", data: draft }]
            : [];
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      lte: () => chain,
      gt: () => chain,
      not: () => chain,
      is: () => chain,
      order: () => chain,
      maybeSingle: async () => ({
        data: table === "camp_bookings" ? null : data,
        error: null,
      }),
      upsert: f.upsert,
      then: (resolve: any) =>
        Promise.resolve({ data, error: null }).then(resolve),
    };
    return chain;
  });
});
afterEach(() => vi.unstubAllEnvs());

it.each(["admin", "staff"])(
  "%s sees existing families and saved drafts and can save edits",
  async (role) => {
    f.session.role = role;
    const review = await campReview(campId);
    expect(review.families).toEqual(families);
    const visibleDraft =
      role === "staff"
        ? { ...draft, payment_id: reviewReference(draft.payment_id) }
        : draft;
    expect(review.records[0].draft).toEqual(visibleDraft);
    if (role === "staff") {
      const serialized = JSON.stringify(review);
      for (const secret of [
        "pi_paid",
        "cs_live_paid",
        "cus_paid",
        '"amount"',
        '"currency"',
      ])
        expect(serialized).not.toContain(secret);
      await expect(saveCampReview(visibleDraft, false)).resolves.toEqual({
        ok: true,
      });
    }
    await expect(saveCampReview(draft, false)).resolves.toEqual({ ok: true });
    expect(f.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        updated_by: "coach-id",
        data: expect.objectContaining({ notes: draft.notes }),
      }),
    );
    expect(f.prepare).not.toHaveBeenCalled();
  },
);

it.each(["admin", "staff"])(
  "%s uses the existing verified importer for existing and new families",
  async (role) => {
    f.session.role = role;
    for (const newFamily of [false, true]) {
      const input = {
        ...draft,
        ...(newFamily
          ? {
              parent_id: null,
              player_id: null,
              new_parent: {
                name: "New Parent",
                email: "new@example.invalid",
                phone: "",
              },
            }
          : {}),
      };
      await expect(saveCampReview(input, true)).resolves.toEqual({
        ok: true,
        id: "booking-id",
      });
      expect(f.prepare).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining(input),
        "cs_live_paid",
        "coach-id",
        expect.anything(),
      );
      expect(f.rpc).toHaveBeenLastCalledWith(
        newFamily ? "camp_import_review_booking" : "camp_import_paid_booking",
        { input: expect.objectContaining({ actor_id: "coach-id" }) },
      );
    }
  },
);

it.each(["parent", null])(
  "rejects %s before reading family data or saving/importing",
  async (role) => {
    f.session = role ? { role, user: { id: "parent-id" } } : null;
    await expect(campReview(campId)).rejects.toThrow();
    await expect(saveCampReview(draft, false)).rejects.toThrow();
    await expect(saveCampReview(draft, true)).rejects.toThrow();
    expect(f.from).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
  },
);

it.each(["review", "refunded"])(
  "still blocks importing a %s payment for coaches",
  async (status) => {
    f.snapshot.records[0].status = status;
    await expect(saveCampReview(draft, true)).rejects.toThrow(
      "Zahlung benötigt Klärung",
    );
    expect(f.prepare).not.toHaveBeenCalled();
  },
);

it("shows an age-boundary validation so the team can confirm it explicitly", async () => {
  f.rpc.mockImplementation(async (name) =>
    name === "camp_import_paid_booking"
      ? {
          data: null,
          error: {
            code: "P0001",
            message:
              "Altersgrenze zum Campbeginn unklar. Bitte prüfen und bestätigen.",
          },
        }
      : { data: 0, error: null },
  );
  await expect(
    saveCampReview(
      { ...draft, child: { ...draft.child, age_at_booking: 11 } },
      true,
    ),
  ).rejects.toThrow("Altersgrenze zum Campbeginn unklar");
});

it("offers special-discount approval only to admins and retains scanned amounts", async () => {
  f.snapshot.records[0].discount = 22671;
  f.snapshot.records[0].subtotal = 22900;
  f.snapshot.records[0].amount = 229;
  f.session.role = "admin";
  expect((await campReview(campId)).records[0]).toMatchObject({
    special_discount_review: true,
    discount: 22671,
    amount: 229,
  });
  f.session.role = "staff";
  const record = (await campReview(campId)).records[0];
  for (const field of [
    "special_discount_review",
    "discount",
    "subtotal",
    "amount",
    "session_id",
  ])
    expect(record[field as keyof typeof record]).toBeUndefined();
});
