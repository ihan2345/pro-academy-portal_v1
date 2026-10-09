import { expect, it } from "vitest";
import {
  changeProfileChild,
  profileChildSchema,
} from "../src/lib/server/parent-profile";
import { childCardTheme, childInitials } from "../src/lib/parent-profile";
it.each(["staff", null])(
  "blocks %s before any child mutation",
  async (role) => {
    await expect(
      changeProfileChild({ role } as any, "parent", "unlink", {}),
    ).rejects.toThrow("Keine Berechtigung");
    await expect(
      changeProfileChild({ role } as any, "parent", "child", {}),
    ).rejects.toThrow("Keine Berechtigung");
  },
);
it("rejects non-profile fields and invalid child names", () => {
  const valid = {
    child_id: "a1234567-1234-4234-8234-123456789012",
    first_name: "Ada",
    last_name: "Test",
    birth_year: null,
    team: "U10",
  };
  expect(profileChildSchema.safeParse(valid).success).toBe(true);
  expect(
    profileChildSchema.safeParse({ ...valid, archived_at: null }).success,
  ).toBe(false);
  expect(
    profileChildSchema.safeParse({ ...valid, first_name: " " }).success,
  ).toBe(false);
});
it("uses two initials and the highest matching premium theme", () => {
  expect(childInitials(" Ada ", "Test")).toBe("AT");
  expect(childCardTheme(["First Touch"])).toBe("black");
  expect(childCardTheme(["FirstTouch", "GameChanger"])).toBe("purple");
  expect(childCardTheme(["Pro", "GameChanger"])).toBe("neon");
  expect(childCardTheme(["Next Level"])).toBe("neon");
  expect(childCardTheme([])).toBe("neutral");
});

it("parents cannot unlink children", async () => {
  await expect(
    changeProfileChild({ role: "parent" } as any, "parent", "unlink", {}),
  ).rejects.toThrow("Keine Berechtigung");
});
