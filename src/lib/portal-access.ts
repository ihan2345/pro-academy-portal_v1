export type PortalRole = "parent" | "staff" | "admin";

export function portalHome(role: PortalRole) {
  return role === "admin" ? "/admin" : role === "staff" ? "/team" : "/";
}

export function canOpenPortalSection(role: PortalRole, section: string) {
  // Shared portal areas keep the signed-in user in their own role.
  if (section === "konto" || section === "pai" || section === "produkte")
    return true;
  if (section === "admin" || section.startsWith("admin/"))
    return role === "admin";
  if (section === "team" || section.startsWith("team/"))
    return role === "staff";
  return role === "parent";
}

export type CampAccess = "active" | "past" | "only";
/**
 * Camp access never grants training or stamp-card rights. Those follow the
 * actual subscriptions; account, Camp, profile and shop areas stay open.
 */
export function campAccessRedirect(access: CampAccess, section: string) {
  if (access === "active") return null;
  if (section === "" || section === "stempelkarte") return "/camps";
  if (access === "only" && section === "termine") return "/camps";
  return null;
}
