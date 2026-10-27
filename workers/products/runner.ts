// Local product/test-subscription events and private guest-mail capture only. No SMTP or training jobs.
import { CaptureProvider } from "../../src/lib/mail";
import { mkdir, writeFile } from "node:fs/promises";
import { processGuestMessages } from "../../src/lib/server/products/guest-messages";
import { processProductEvents } from "../../src/lib/server/products/events";
import {
  pollProductEvents,
  productWorkerHeartbeat,
} from "../../src/lib/server/products/poll";
import { requireProductPayments } from "../../src/lib/server/products/runtime";
requireProductPayments();
const guestCapture = new CaptureProvider(async (mail) => {
  await mkdir("output/product-management-local/guest-mail", {
    recursive: true,
  });
  const name = mail.messageId.replace(/[^a-zA-Z0-9-]/g, "_");
  await writeFile(
    `output/product-management-local/guest-mail/${name}.private.json`,
    JSON.stringify(mail, null, 2),
    { mode: 0o600 },
  );
});
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
    await processGuestMessages(guestCapture);
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
