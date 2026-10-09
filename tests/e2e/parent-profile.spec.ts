import { test, expect } from "@playwright/test";
import { login, localDb, twoChildFamily, localAccounts } from "./local-test";

test("parent profile is private, read-only email and responsive", async ({
  page,
}, testInfo) => {
  await login(page, twoChildFamily.key);
  await page.goto("/profil");
  await expect(
    page.getByRole("heading", { name: twoChildFamily.name, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Zugeordnete Kinder" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Finanzübersicht" }),
  ).toHaveCount(0);
  const foreign = await localDb
    .from("parents")
    .select("id")
    .neq("full_name", twoChildFamily.name)
    .is("archived_at", null)
    .limit(1)
    .single();
  expect(foreign.error).toBeNull();
  expect(
    (
      await page.request.get(`/api/parent-profiles/${foreign.data!.id}`)
    ).status(),
  ).toBe(404);
  expect((await page.request.get("/api/parent-profiles/list")).status()).toBe(
    403,
  );
  await page.getByRole("button", { name: "Kontaktdaten bearbeiten" }).click();
  await expect(page.getByRole("dialog")).toContainText("unveränderbar");
  await expect(page.locator('input[type="email"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Dialog schließen" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `output/parent-profile-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("link", { name: "Alle Einheiten", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Alle Einheiten/ }),
  ).toBeVisible();
  await expect(page.getByLabel("Kind filtern")).toBeVisible();
});

test("staff can open family profiles but cannot fetch finance or edit", async ({
  page,
}) => {
  await login(page, "trainer");
  await page.goto("/team/elternprofile");
  const link = page.locator('a[href^="/team/elternprofile/"]').first();
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  await link.click();
  await expect(
    page.getByRole("heading", { name: "Zugeordnete Kinder" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Kontaktdaten bearbeiten" }),
  ).toHaveCount(0);
  const id = href!.split("/").at(-1)!;
  const origin = new URL(page.url()).origin;
  expect(
    (
      await page.request.post(`/api/parent-profiles/${id}/finances`, {
        headers: { origin },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post(`/api/parent-profiles/${id}/contact`, {
        headers: { origin },
        data: { phone: "1", city: "X" },
      })
    ).status(),
  ).toBe(403);
  const response = await page.request.get(`/api/parent-profiles/${id}`);
  const body = await response.text();
  for (const key of [
    "stripe_customer_id",
    "billing_email",
    "paid_amount",
    "stripe_data",
  ])
    expect(body).not.toContain(key);
});

test("admin filters families and automatically loads finances after render", async ({
  page,
}) => {
  let financeCalls = 0;
  await page.route("**/api/parent-profiles/*/finances", async (route) => {
    financeCalls++;
    await route.fulfill({
      json: {
        checked_at: new Date().toISOString(),
        complete: true,
        notes: [],
        currencies: [],
      },
    });
  });
  await login(page, "admin");
  await page.goto("/admin/elternprofile");
  for (const sort of ["months", "newest", "name"]) {
    const response = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/parent-profiles/list?`) &&
        r.url().includes(`sort=${sort}`),
    );
    await page.getByLabel("Elternprofile sortieren").selectOption(sort);
    expect((await response).ok()).toBe(true);
  }
  const inactive = page.getByLabel(
    "Eltern ohne aktives Abo zusätzlich anzeigen",
  );
  await expect(inactive).not.toBeChecked();
  const included = page.waitForResponse((r) =>
    r.url().includes("includeInactive=true"),
  );
  await inactive.check();
  expect((await included).ok()).toBe(true);
  await page
    .getByLabel("Eltern nach Name oder E-Mail suchen")
    .fill(twoChildFamily.name);
  const link = page
    .locator('a[href^="/admin/elternprofile/"]')
    .filter({ hasText: twoChildFamily.name });
  await expect(link).toHaveCount(1);
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await link.click();
  await expect(
    page.getByRole("heading", { name: "Finanzübersicht" }),
  ).toBeVisible();
  expect(financeCalls).toBe(0);
  await page.clock.runFor(1499);
  expect(financeCalls).toBe(0);
  await page.clock.runFor(1);
  await expect(
    page.getByText("Keine vereinnahmten Stripe-Zahlungen gefunden."),
  ).toBeVisible();
  expect(financeCalls).toBe(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "output/profile-status-updated.png",
    fullPage: true,
  });
  await expect(
    page.getByRole("button", { name: "Aktualisieren" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Kind archivieren" }).first(),
  ).toBeVisible();
});

test("local contact and archive lifecycle preserves email, quota and history", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "desktop",
    "Database lifecycle is tested once; mobile layout has separate coverage.",
  );
  const original = await localDb
    .from("parents")
    .select("id,phone,city,contact_email,profile_self_service_updated_at")
    .eq("full_name", twoChildFamily.name)
    .single();
  expect(original.error).toBeNull();
  const parent = original.data!;
  const link = await localDb
    .from("parent_players")
    .select("player_id")
    .eq("parent_id", parent.id)
    .limit(1)
    .single();
  expect(link.error).toBeNull();
  const child = await localDb
    .from("players")
    .select("archived_at")
    .eq("id", link.data!.player_id)
    .single();
  expect(child.error).toBeNull();
  try {
    await localDb
      .from("parents")
      .update({ profile_self_service_updated_at: null })
      .eq("id", parent.id);
    await login(page, twoChildFamily.key);
    await page.goto("/profil");
    const origin = new URL(page.url()).origin;
    const path = `/api/parent-profiles/${parent.id}`;
    expect(
      (
        await page.request.post(`${path}/contact`, {
          headers: { origin },
          data: {
            phone: "123",
            city: "Berlin",
            email: "forged@example.invalid",
          },
        })
      ).status(),
    ).toBe(400);
    await page.getByRole("button", { name: "Kontaktdaten bearbeiten" }).click();
    await page.getByLabel("Telefonnummer", { exact: true }).fill("0123 456789");
    await page.getByLabel("Ort", { exact: true }).fill("Profiltest");
    await page.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Kontaktdaten bearbeiten" }),
    ).toBeDisabled();
    expect(
      (
        await page.request.post(`${path}/contact`, {
          headers: { origin },
          data: { phone: "999", city: "Andere Stadt" },
        })
      ).status(),
    ).toBe(429);
    expect(
      (
        await page.request.post(`${path}/archive`, {
          headers: { origin },
          data: { child_id: link.data!.player_id },
        })
      ).status(),
    ).toBe(403);
    const before = await localDb
      .from("parents")
      .select("profile_self_service_updated_at")
      .eq("id", parent.id)
      .single();
    await login(page, "admin");
    expect(
      (
        await page.request.post(`${path}/contact`, {
          headers: { origin },
          data: { phone: "0123 456789", city: "Admin Profiltest" },
        })
      ).status(),
    ).toBe(200);
    const after = await localDb
      .from("parents")
      .select("profile_self_service_updated_at,contact_email")
      .eq("id", parent.id)
      .single();
    expect(after.data?.profile_self_service_updated_at).toBe(
      before.data?.profile_self_service_updated_at,
    );
    expect(after.data?.contact_email).toBe(parent.contact_email);
    expect(
      (
        await page.request.post(`${path}/archive`, {
          headers: { origin },
          data: { child_id: link.data!.player_id },
        })
      ).status(),
    ).toBe(200);
    const remains = await localDb
      .from("parent_players")
      .select("player_id")
      .eq("parent_id", parent.id)
      .eq("player_id", link.data!.player_id)
      .single();
    expect(remains.data?.player_id).toBe(link.data!.player_id);
  } finally {
    const { id, contact_email, ...restore } = parent;
    await localDb.from("parents").update(restore).eq("id", id);
    await localDb
      .from("players")
      .update({ archived_at: child.data!.archived_at })
      .eq("id", link.data!.player_id);
  }
});

test("admin edits child, opens selected stamp card and confirms unlink without deleting child", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "Local mutation lifecycle once.");
  const parent = await localDb
    .from("parents")
    .select("id")
    .eq("full_name", twoChildFamily.name)
    .single();
  expect(parent.error).toBeNull();
  const links = await localDb
    .from("parent_players")
    .select("*")
    .eq("parent_id", parent.data!.id);
  expect(links.error).toBeNull();
  const link = links.data![0];
  const original = await localDb
    .from("players")
    .select("*")
    .eq("id", link.player_id)
    .single();
  expect(original.error).toBeNull();
  const child = original.data!;
  await page.route("**/api/parent-profiles/*/finances", (route) =>
    route.fulfill({
      json: {
        complete: true,
        currencies: [],
        notes: [],
        checked_at: new Date().toISOString(),
      },
    }),
  );
  try {
    await login(page, "admin");
    await page.goto(`/admin/elternprofile/${parent.data!.id}`);
    await page
      .getByLabel("Kind für Stempelkarte auswählen")
      .selectOption(child.id);
    await page.getByRole("link", { name: "Stempelkarte anzeigen" }).click();
    await expect(
      page.getByRole("combobox", { name: "Kind auswählen", exact: true }),
    ).toHaveValue(child.id, { timeout: 15000 });
    await page.goto(`/admin/elternprofile/${parent.data!.id}`);
    const card = page.locator("article.profile-child").filter({
      has: page.getByRole("heading", {
        name: `${child.first_name} ${child.last_name}`,
        exact: true,
      }),
    });
    await card
      .getByRole("button", { name: "Angaben des Kindes bearbeiten" })
      .click();
    await page.getByLabel("Vorname", { exact: true }).fill("Profiltest");
    await page.getByRole("button", { name: "Änderungen speichern" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      (
        await localDb
          .from("players")
          .select("first_name")
          .eq("id", child.id)
          .single()
      ).data?.first_name,
    ).toBe("Profiltest");
    const changed = page
      .locator("article.profile-child")
      .filter({ hasText: `Profiltest ${child.last_name}` });
    await changed
      .getByRole("button", { name: "Kind vom Elternteil lösen" })
      .click();
    await expect(page.getByRole("dialog")).toContainText("Sind Sie sicher");
    await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
    expect(
      (
        await localDb
          .from("parent_players")
          .select("id")
          .eq("id", link.id)
          .single()
      ).error,
    ).toBeNull();
    await changed
      .getByRole("button", { name: "Kind vom Elternteil lösen" })
      .click();
    await page
      .getByRole("button", { name: "Verknüpfung lösen", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(changed).toHaveCount(0);
    expect(
      (await localDb.from("parent_players").select("id").eq("id", link.id))
        .data,
    ).toEqual([]);
    expect(
      (
        await localDb
          .from("players")
          .select("archived_at")
          .eq("id", child.id)
          .single()
      ).data?.archived_at,
    ).toBe(child.archived_at);
  } finally {
    expect(
      (
        await localDb
          .from("players")
          .update({
            first_name: child.first_name,
            last_name: child.last_name,
            birth_year: child.birth_year,
            team: child.team,
          })
          .eq("id", child.id)
      ).error,
    ).toBeNull();
    expect(
      (await localDb.from("parent_players").upsert(link)).error,
    ).toBeNull();
  }
});

test("profile list keeps selection within area and resets after leaving", async ({
  page,
}) => {
  await page.route("**/api/parent-profiles/*/finances", (route) =>
    route.fulfill({
      json: {
        complete: true,
        currencies: [],
        notes: [],
        checked_at: new Date().toISOString(),
      },
    }),
  );
  await login(page, "admin");
  await page.goto("/admin/elternprofile");
  await page.getByLabel("Eltern ohne aktives Abo zusätzlich anzeigen").check();
  await page.getByLabel("Elternprofile sortieren").selectOption("months");
  const ready = page.waitForResponse((r) =>
    r.url().includes("search=a&offset=0&includeInactive=true&sort=months"),
  );
  await page.getByLabel("Eltern nach Name oder E-Mail suchen").fill("a");
  expect((await ready).ok()).toBe(true);
  const next = page.waitForResponse((r) =>
    r.url().includes("search=a&offset=25&includeInactive=true&sort=months"),
  );
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  expect((await next).ok()).toBe(true);
  const first = page.locator("a.profile-list-row").first();
  const href = await first.getAttribute("href");
  await first.click();
  await expect(
    page.getByRole("heading", { name: "Zugeordnete Kinder" }),
  ).toBeVisible();
  await page
    .locator(".profile-breadcrumb")
    .getByRole("link", { name: "Elternprofile", exact: true })
    .click();
  async function retained() {
    await expect(
      page.getByLabel("Eltern nach Name oder E-Mail suchen"),
    ).toHaveValue("a");
    await expect(page.getByLabel("Elternprofile sortieren")).toHaveValue(
      "months",
    );
    await expect(
      page.getByLabel("Eltern ohne aktives Abo zusätzlich anzeigen"),
    ).toBeChecked();
    await expect(page.getByText("Seite 2", { exact: true })).toBeVisible();
    await expect(page.locator("a.profile-list-row").first()).toHaveAttribute(
      "href",
      href!,
    );
  }
  await retained();
  await page.locator("a.profile-list-row").first().click();
  await expect(
    page.getByRole("heading", { name: "Zugeordnete Kinder" }),
  ).toBeVisible();
  await page.goBack();
  await retained();
  if (
    !(await page
      .locator(".sidebar")
      .getByRole("link", { name: "Verwaltung", exact: true })
      .isVisible())
  )
    await page
      .getByRole("button", { name: "Menü öffnen", exact: true })
      .click();
  await page
    .locator(".sidebar")
    .getByRole("link", { name: "Verwaltung", exact: true })
    .click();
  await page.waitForURL("**/admin");
  if (
    !(await page
      .locator(".sidebar")
      .getByRole("link", { name: "Elternprofile", exact: true })
      .isVisible())
  )
    await page
      .getByRole("button", { name: "Menü öffnen", exact: true })
      .click();
  await page
    .locator(".sidebar")
    .getByRole("link", { name: "Elternprofile", exact: true })
    .click();
  await expect(
    page.getByLabel("Eltern nach Name oder E-Mail suchen"),
  ).toHaveValue("");
  await expect(page.getByLabel("Elternprofile sortieren")).toHaveValue("name");
  await expect(
    page.getByLabel("Eltern ohne aktives Abo zusätzlich anzeigen"),
  ).not.toBeChecked();
  await expect(page.getByText("Seite 1", { exact: true })).toBeVisible();
});

test("parent edits own child but cannot edit foreign children or unlink", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "Local mutation lifecycle once.");
  const parent = await localDb
    .from("parents")
    .select("id")
    .eq("full_name", twoChildFamily.name)
    .single();
  expect(parent.error).toBeNull();
  const links = await localDb
    .from("parent_players")
    .select("player_id")
    .eq("parent_id", parent.data!.id);
  expect(links.error).toBeNull();
  const original = await localDb
    .from("players")
    .select("*")
    .eq("id", links.data![0].player_id)
    .single();
  expect(original.error).toBeNull();
  const child = original.data!;
  try {
    await login(page, twoChildFamily.key);
    await page.goto("/profil");
    await expect(
      page.getByRole("button", { name: "Kind vom Elternteil lösen" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Kind archivieren" }),
    ).toHaveCount(0);
    const card = page.locator("article.profile-child").filter({
      has: page.getByRole("heading", {
        name: `${child.first_name} ${child.last_name}`,
        exact: true,
      }),
    });
    await card
      .getByRole("button", { name: "Angaben des Kindes bearbeiten" })
      .click();
    await page.getByLabel("Vorname", { exact: true }).fill("Elterntest");
    await page.getByRole("button", { name: "Änderungen speichern" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      (
        await localDb
          .from("players")
          .select("first_name")
          .eq("id", child.id)
          .single()
      ).data?.first_name,
    ).toBe("Elterntest");
    const origin = new URL(page.url()).origin;
    expect(
      (
        await page.request.post(
          `/api/parent-profiles/${parent.data!.id}/unlink`,
          { headers: { origin }, data: { child_id: child.id } },
        )
      ).status(),
    ).toBe(403);
    const foreign = await localDb
      .from("players")
      .select("id")
      .not("id", "in", `(${links.data!.map((l) => l.player_id).join(",")})`)
      .limit(1)
      .single();
    const fields = {
      child_id: foreign.data!.id,
      first_name: "Forbidden",
      last_name: "Test",
      birth_year: 2015,
      team: "U10",
    };
    expect(
      (
        await page.request.post(
          `/api/parent-profiles/${parent.data!.id}/child`,
          { headers: { origin }, data: fields },
        )
      ).status(),
    ).toBe(404);
  } finally {
    expect(
      (
        await localDb
          .from("players")
          .update({
            first_name: child.first_name,
            last_name: child.last_name,
            birth_year: child.birth_year,
            team: child.team,
          })
          .eq("id", child.id)
      ).error,
    ).toBeNull();
  }
});

test("inactive family loses four status months and keeps the deduction after restart", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile",
    "One local mutation scenario is sufficient",
  );
  const { Temporal } = await import("@js-temporal/polyfill");
  const { createHash } = await import("node:crypto");
  const now = Temporal.Now.zonedDateTimeISO("Europe/Berlin").subtract({
    minutes: 2,
  });
  const parent = await localDb
    .from("parents")
    .select("id")
    .eq("full_name", twoChildFamily.name)
    .single();
  expect(parent.error).toBeNull();
  const children = await localDb
    .from("parent_players")
    .select("player_id")
    .eq("parent_id", parent.data!.id);
  const mappings = await localDb
    .from("subscription_players")
    .select(
      "player_id,stripe_item_id,subscriptions!inner(id,stripe_subscription_id,status,stripe_data)",
    )
    .in(
      "player_id",
      children.data!.map((c) => c.player_id),
    );
  expect(mappings.error).toBeNull();
  const links = mappings.data as any[];
  expect(links.length).toBeGreaterThan(0);
  const subs = [
    ...new Map(
      links.map((l) => [l.subscriptions.id, l.subscriptions]),
    ).values(),
  ];
  expect(
    subs.every((s) => /^sub_[A-Za-z0-9]+$/.test(s.stripe_subscription_id)),
  ).toBe(true);
  const ids = subs.map((s) => s.id);
  const previous = await localDb
    .from("profile_subscription_history")
    .select("*")
    .in("subscription_id", ids);
  expect(previous.error).toBeNull();
  const first = links[0];
  const range = (agoStart: number, agoEnd: number) => ({
    item: first.stripe_item_id,
    start: now.subtract({ months: agoStart }).epochMilliseconds / 1000,
    end: now.subtract({ months: agoEnd }).epochMilliseconds / 1000,
  });
  async function seed(restart = false) {
    for (const sub of subs) {
      const signature = createHash("sha256")
        .update(
          JSON.stringify({
            version: 2,
            stripe: sub.stripe_subscription_id,
            status: sub.status,
            ended: sub.stripe_data?.ended_at,
            items: sub.stripe_data?.items,
          }),
        )
        .digest("hex");
      const seeded = await localDb.from("profile_subscription_history").upsert({
        subscription_id: sub.id,
        source_signature: signature,
        checked_at: new Date().toISOString(),
        periods:
          sub.id === first.subscriptions.id
            ? restart
              ? [range(21, 5), range(1, -1)]
              : [range(20, 4)]
            : [],
      });
      expect(seeded.error).toBeNull();
    }
  }
  try {
    await seed();
    await login(page, twoChildFamily.key);
    await page.goto("/profil");
    await expect(
      page.getByRole("heading", { name: "Gold", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("progressbar", { name: "Familienstatus" }),
    ).toHaveAttribute("aria-valuenow", "12");
    await expect(
      page.getByText("16 aktive Abo-Monate − 4 Monate Inaktivitätsabzug", {
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: "output/profile-status/decay-profile.png",
      fullPage: true,
    });
    await seed(true);
    await page.reload();
    await expect(
      page.getByRole("progressbar", { name: "Familienstatus" }),
    ).toHaveAttribute("aria-valuenow", "13");
    await expect(
      page.getByText("17 aktive Abo-Monate − 4 Monate Inaktivitätsabzug", {
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    expect(
      (
        await localDb
          .from("profile_subscription_history")
          .delete()
          .in("subscription_id", ids)
      ).error,
    ).toBeNull();
    if (previous.data!.length)
      expect(
        (
          await localDb
            .from("profile_subscription_history")
            .insert(previous.data!)
        ).error,
      ).toBeNull();
  }
});
