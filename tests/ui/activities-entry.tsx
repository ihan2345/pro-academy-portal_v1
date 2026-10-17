import React from "react";
import { createRoot } from "react-dom/client";
import { Portal } from "../../src/components/portal";
import { Activities } from "../../src/components/activities";
import { portalFixture } from "../fixtures/portal";
const staff = location.pathname.startsWith("/team"),
  base = staff ? "/team/aktivitaeten" : "/admin/aktivitaeten";
createRoot(document.getElementById("root")!).render(
  <Portal
    initial={{ ...portalFixture, role: staff ? "staff" : "admin" }}
    section={location.pathname.slice(1)}
  >
    <Activities base={base} all={location.pathname.endsWith("/alle")} />
  </Portal>,
);
