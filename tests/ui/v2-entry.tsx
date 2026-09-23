import React from "react";
import { createRoot } from "react-dom/client";
import { AdminView } from "../../src/components/admin";
import { StampCards } from "../../src/components/stamp-cards";
import { portalFixture } from "../fixtures/portal";

const data = { ...portalFixture, role: "admin" as const };
createRoot(document.getElementById("root")!).render(
  <main style={{ maxWidth: 1100, margin: "24px auto", padding: 16 }}>
    {new URLSearchParams(location.search).get("view") === "cards" ? (
      <StampCards
        data={data}
        notify={(text) => {
          document.getElementById("message")!.textContent = text;
        }}
      />
    ) : (
      <AdminView
        data={data}
        section="admin/stripe"
        notify={(text) => {
          document.getElementById("message")!.textContent = text;
        }}
      />
    )}
    <p role="status" id="message" />
  </main>,
);
