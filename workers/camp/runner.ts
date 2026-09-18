// Dedicated Camp process. No imports from the existing jobs, invitation or mail runners.
import { runCampProcessing } from "../../src/lib/camps/processing";
import { campProcessingEnabled } from "../../src/lib/camps/processing-config";
if (!campProcessingEnabled())
  throw new Error(
    "Camp-Verarbeitung bleibt ausgeschaltet. Separate Release-Freigabe erforderlich.",
  );
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    stopping = true;
  });
const once = process.argv.includes("--once");
async function main() {
  do {
    try {
      const result = await runCampProcessing();
      console.log(JSON.stringify({ camp_processing: result }));
      if (once && result.failed) process.exitCode = 1;
    } catch {
      console.error(
        "Camp-Abgleich fehlgeschlagen. Wiederholung im nächsten Lauf.",
      );
      if (once) process.exitCode = 1;
    }
    if (once || stopping) break;
    // Short slices allow graceful shutdown without abandoning in-flight payments.
    for (let seconds = 0; seconds < 300 && !stopping; seconds++)
      await new Promise((resolve) => setTimeout(resolve, 1000));
  } while (!stopping);
}
void main().catch(() => {
  console.error("Camp-Verarbeitung konnte nicht gestartet werden.");
  process.exitCode = 1;
});
