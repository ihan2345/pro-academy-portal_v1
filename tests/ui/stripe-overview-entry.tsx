import React from "react";
import { createRoot } from "react-dom/client";
import { Portal } from "../../src/components/portal";
import { SubscriptionReviews } from "../../src/components/subscription-reviews";
import { StripeActivityPreview } from "../../src/components/stripe-activity-preview";
import { portalFixture } from "../fixtures/portal";

createRoot(document.getElementById("root")!).render(
  <Portal
    initial={{ ...portalFixture, role: "admin", players: [], events: [] }}
    section="admin"
  >
    <div className="page-heading">
      <h1>Alles im Blick.</h1>
      <p>Organisation, Training und Entwicklung an einem Ort.</p>
    </div>
    <SubscriptionReviews />
    <StripeActivityPreview />
  </Portal>,
);
