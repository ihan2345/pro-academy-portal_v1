import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ list: vi.fn(), client: vi.fn() }));
vi.mock("../src/lib/server/profile-stripe", () => ({
  profileStripeClient: () => {
    mock.client();
    return { checkout: { sessions: { list: mock.list } } };
  },
}));
import { stripeParentInputs } from "../src/lib/server/stripe-parent-inputs";
const session = { role: "admin" } as any;
const field = (type: string, value: string) => ({
  key: type,
  label: { custom: `Feld ${type}` },
  type,
  [type]: { value, options: [{ value: "a", label: "Auswahl A" }] },
});
const checkout = {
  id: "cs_one",
  customer: "cus_one",
  subscription: "sub_one",
  status: "complete",
  created: 1700000000,
  custom_fields: [
    field("text", "Name <script>"),
    field("numeric", "0012"),
    field("dropdown", "a"),
  ],
  metadata: { private: "secret" },
  url: "secret",
};
beforeEach(() => {
  mock.list.mockReset();
  mock.client.mockClear();
});
it("keeps original text and numeric values and translates dropdown labels without leaking raw objects", async () => {
  mock.list.mockResolvedValue({ data: [checkout], has_more: false });
  const r = await stripeParentInputs(session, {
    customer: "cus_one",
    subscription: "sub_one",
  });
  expect(r.entries[0].fields.map((f) => f.value)).toEqual([
    "Name <script>",
    "0012",
    "Auswahl A",
  ]);
  expect(JSON.stringify(r)).not.toContain("secret");
  expect(mock.list.mock.calls[0][0]).toEqual({
    customer: "cus_one",
    subscription: "sub_one",
    limit: 100,
  });
});
it("reads subsequent pages and isolates the requested customer and subscription", async () => {
  mock.list
    .mockResolvedValueOnce({
      data: [
        { ...checkout, id: "cs_other", subscription: "sub_other" },
        { ...checkout, id: "cs_open", status: "open" },
      ],
      has_more: true,
    })
    .mockResolvedValueOnce({
      data: [checkout, { ...checkout, id: "cs_wrong", customer: "cus_wrong" }],
      has_more: false,
    });
  const r = await stripeParentInputs(session, {
    customer: "cus_one",
    subscription: "sub_one",
  });
  expect(r.entries.map((e) => e.sessionId)).toEqual(["cs_one"]);
  expect(mock.list.mock.calls[1][0].starting_after).toBe("cs_open");
});
it("keeps distinct submissions separate and records optional empty fields", async () => {
  mock.list.mockResolvedValue({
    data: [
      checkout,
      {
        ...checkout,
        id: "cs_two",
        custom_fields: [field("text", null as any)],
      },
    ],
    has_more: false,
  });
  const r = await stripeParentInputs(session, { customer: "cus_one" });
  expect(r.entries).toHaveLength(2);
  expect(r.entries[1].fields[0].value).toBeNull();
});
it("distinguishes absent fields from a failed read", async () => {
  mock.list.mockResolvedValueOnce({ data: [], has_more: false });
  expect(await stripeParentInputs(session, { customer: "cus_one" })).toEqual({
    entries: [],
    partial: false,
  });
  mock.list.mockRejectedValueOnce(Error("private"));
  await expect(
    stripeParentInputs(session, { customer: "cus_one" }),
  ).rejects.toThrow("nicht geladen");
});
it("marks partial history when later page fails", async () => {
  mock.list
    .mockResolvedValueOnce({ data: [checkout], has_more: true })
    .mockRejectedValueOnce(Error("private"));
  const r = await stripeParentInputs(session, { customer: "cus_one" });
  expect(r.entries).toHaveLength(1);
  expect(r.partial).toBe(true);
});
it.each(["staff", "parent", undefined])(
  "denies %s before calling Stripe",
  async (role) => {
    await expect(
      stripeParentInputs({ role } as any, { customer: "cus_one" }),
    ).rejects.toThrow();
    expect(mock.client).not.toHaveBeenCalled();
  },
);
it("validates identifiers before making a request", async () => {
  await expect(
    stripeParentInputs(session, { customer: "cus_one?secret" }),
  ).rejects.toThrow();
  expect(mock.client).not.toHaveBeenCalled();
});
