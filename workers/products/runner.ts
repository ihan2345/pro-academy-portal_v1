// Local product and external test-subscription events only. No mail/training jobs.
import { processProductEvents } from "../../src/lib/server/products/events";
import {
  pollProductEvents,
  productWorkerHeartbeat,
} from "../../src/lib/server/products/poll";
import { requireProductPayments } from "../../src/lib/server/products/runtime";
requireProductPayments();
async function tick() {
  let error = false;
  try {
    await pollProductEvents();
  } catch {
    error = true;
    console.error("Stripe-Testereignisabruf fehlgeschlagen; wird wiederholt.");
  }
  try {
    const r = await processProductEvents();
    if (r.processed)
      console.log("Lokale Stripe-Testereignisse verarbeitet:", r.processed);
  } catch {
    error = true;
    console.error("Lokale Zahlungsinbox benötigt Prüfung.");
  }
  await productWorkerHeartbeat(error);
}
async function main() {
  if (process.argv.includes("--watch")) {
    for (;;) {
      await tick().catch(() =>
        console.error("Lokale Produktdatenbank nicht erreichbar."),
      );
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  } else await tick();
}
void main().catch(() => {
  console.error("Produkt-Zahlungsworker wurde angehalten.");
  process.exitCode = 1;
});
