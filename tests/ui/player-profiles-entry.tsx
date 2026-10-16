import React from "react";
import { createRoot } from "react-dom/client";
import { Portal } from "../../src/components/portal";
import { PlayerProfiles } from "../../src/components/player-profiles";
import { portalFixture } from "../fixtures/portal";
createRoot(document.getElementById("root")!).render(
  <Portal
    initial={{ ...portalFixture, role: "admin", players: [], events: [] }}
    section="admin/spielerprofile"
  >
    <PlayerProfiles base="/admin/elternprofile" admin />
  </Portal>,
);
