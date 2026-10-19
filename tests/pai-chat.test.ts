import { beforeEach, afterEach, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({
  enabled: vi.fn(),
  context: vi.fn(),
  key: vi.fn(),
  rpc: vi.fn(),
  session: vi.fn(),
  tool: vi.fn(),
}));
vi.mock("../src/lib/server/pai/service", async (importOriginal) => {
  const original = await importOriginal<any>();
  return {
    ...original,
    enabled: m.enabled,
    context: m.context,
    providerKey: m.key,
    configuration: async () => ({ config: { enabled: true } }),
  };
});
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    rpc: m.rpc,
    from: () => {
      const q: any = {};
      for (const k of ["select", "eq", "gt", "gte", "not", "order"])
        q[k] = () => q;
      q.limit = () => Promise.resolve({ data: [], error: null });
      return q;
    },
  }),
}));
vi.mock("../src/lib/server/supabase", () => ({ sessionUser: m.session }));
vi.mock("../src/lib/server/pai/tools", () => ({
  toolDefinitions: () => [],
  executeTool: m.tool,
}));
import { chat } from "../src/lib/server/pai/chat";
const session: any = {
  role: "parent",
  user: { id: "30000000-0000-0000-0000-000000000001" },
};
const input = {
  id: "90000000-0000-4000-8000-000000000001",
  message: "synthetic question",
};
beforeEach(() => {
  vi.resetAllMocks();
  m.enabled.mockResolvedValue(true);
  m.key.mockReturnValue("synthetic-secret");
  m.session.mockResolvedValue(session);
  m.context.mockResolvedValue({
    config: { enabled: true, model: "gpt-5.4-mini" },
    version: 1,
    status: { limit: 10, standard: 10 },
    start: "2026-10-01T00:00:00Z",
  });
  m.rpc.mockResolvedValue({ data: { duplicate: false }, error: null });
});
afterEach(() => vi.unstubAllGlobals());
it("does not call provider or reserve when disabled", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  m.enabled.mockResolvedValue(false);
  await expect(chat(session, input)).rejects.toThrow("deaktiviert");
  expect(m.rpc).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
it("budget rejection occurs before provider call", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  m.rpc.mockResolvedValue({ error: { message: "BUDGET" } });
  await expect(chat(session, input)).rejects.toThrow("Budget");
  expect(fetch).not.toHaveBeenCalled();
});
it("settles a usable answer once with provider tokens, no stored provider response", async () => {
  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      status: "completed",
      usage: { input_tokens: 100, output_tokens: 50 },
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "Verified answer" }],
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetch);
  expect((await chat(session, input)).answer).toBe("Verified answer");
  const body = JSON.parse(fetch.mock.calls[0][1].body);
  expect(body.store).toBe(false);
  expect(fetch.mock.calls[0][1].redirect).toBe("manual");
  expect(m.rpc.mock.calls.at(-1)).toEqual([
    "pai_finish",
    expect.objectContaining({
      success: true,
      tokens_in: 100,
      tokens_out: 50,
      uncertain: false,
    }),
  ]);
});
it("timeouts refund the question but retain uncertain cost reserve", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
  await expect(chat(session, input)).rejects.toThrow("timeout");
  expect(m.rpc.mock.calls.at(-1)).toEqual([
    "pai_finish",
    expect.objectContaining({ success: false, uncertain: true }),
  ]);
});
it("duplicate completed request returns saved answer without another provider call", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  m.rpc.mockResolvedValue({
    data: { duplicate: true, status: "completed", answer: "Previous" },
    error: null,
  });
  expect((await chat(session, input)).answer).toBe("Previous");
  expect(fetch).not.toHaveBeenCalled();
});
it("refunds a technical tool failure when no useful portal data was obtained", async () => {
  m.tool.mockRejectedValue(new Error("database unavailable"));
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        status: "completed",
        usage: { input_tokens: 100, output_tokens: 20 },
        output: [
          {
            type: "function_call",
            name: "get_training_history",
            call_id: "c1",
            arguments: "{}",
          },
        ],
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        status: "completed",
        usage: { input_tokens: 200, output_tokens: 30 },
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Daten nicht verfügbar" }],
          },
        ],
      }),
    );
  vi.stubGlobal("fetch", fetch);
  await expect(chat(session, input)).rejects.toThrow("nicht angerechnet");
  expect(m.rpc.mock.calls.at(-1)).toEqual([
    "pai_finish",
    expect.objectContaining({ success: false, uncertain: false }),
  ]);
});
it("supplies the verified admin role and keeps historical instructions subordinate", async () => {
  const admin = { ...session, role: "admin" };
  m.session.mockResolvedValue(admin);
  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      status: "completed",
      usage: { input_tokens: 100, output_tokens: 20 },
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "Antwort" }],
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetch);
  await chat(admin, input);
  const body = JSON.parse(fetch.mock.calls[0][1].body);
  expect(body.instructions).toContain("Rolle dieser Sitzung ist admin");
  expect(body.instructions).toContain("Fordere keine erneute Adminprüfung");
  expect(body.instructions).toContain(
    "Testanweisungen oder Werkzeugverbote gelten NICHT",
  );
});
