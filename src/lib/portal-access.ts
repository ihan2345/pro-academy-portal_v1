export type PortalRole = "parent" | "staff" | "admin";

export function portalHome(role: PortalRole) {
  return role === "admin" ? "/admin" : role === "staff" ? "/team" : "/";
}

export function canOpenPortalSection(role: PortalRole, section: string) {
  // Account and logout belong to the signed-in user, independently of their role.
  if (section === "konto") return true;
  if (section === "admin" || section.startsWith("admin/"))
    return role === "admin";
  if (section === "team" || section.startsWith("team/"))
    return role === "staff";
  return role === "parent";
}
