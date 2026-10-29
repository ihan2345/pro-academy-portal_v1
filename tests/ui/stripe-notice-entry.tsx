import { createRoot } from "react-dom/client";
import { StripeNoticeOverview } from "../../src/components/stripe-notice-overview";

createRoot(document.getElementById("root")!).render(
  <main style={{ maxWidth: 1000, margin: "24px auto", padding: 16 }}>
    <h1>Übersicht</h1>
    <StripeNoticeOverview section="conflicts" />
    <StripeNoticeOverview section="activities" />
  </main>,
);
