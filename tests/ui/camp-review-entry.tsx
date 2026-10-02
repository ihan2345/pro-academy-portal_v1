import React from "react";
import { createRoot } from "react-dom/client";
import { CampDashboard } from "../../src/components/camps/dashboard";

createRoot(document.getElementById("root")!).render(
  <main style={{ maxWidth: 1100, margin: "24px auto", padding: 16 }}>
    <CampDashboard
      campId="a0000000-0000-4000-8000-000000000001"
      view="pruefung"
    />
  </main>,
);
