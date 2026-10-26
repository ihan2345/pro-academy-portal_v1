import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const app = resolve("output/product-management-local/app");
const values = Object.fromEntries(
  readFileSync(`${app}/.env.local`, "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
if (
  values.APP_MODE !== "test" ||
  values.APP_URL !== "http://127.0.0.1:3110" ||
  values.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:57321"
)
  throw Error("Only the independent local product app is allowed");
const worker = process.argv.includes("--worker"),
  children = [];
const env = {
  ...process.env,
  ...values,
  STRIPE_SECRET_KEY: "",
  STRIPE_WEBHOOK_SECRET: "",
  CAMP_STRIPE_SECRET_KEY: "",
  CAMP_STRIPE_READ_KEY: "",
  CAMP_STRIPE_WEBHOOK_SECRET: "",
  LOCAL_PROFILE_STRIPE_READ: "false",
  NODE_OPTIONS: `--require=${app}/network-guard.cjs`,
};
const runtimeArgs = [
  "--conditions=react-server",
  `--env-file=${app}/.env.local`,
  "--import",
  "tsx",
];
if (!worker) {
  let healthy = false;
  try {
    const r = await fetch("http://127.0.0.1:3111/health", {
      headers: {
        Authorization: `Bearer ${values.PRODUCT_IMAGE_PROCESSOR_SECRET}`,
      },
      signal: AbortSignal.timeout(1000),
    });
    healthy = r.ok;
  } catch {}
  if (!healthy)
    children.push(
      spawn(
        process.execPath,
        [...runtimeArgs, resolve("workers/products/images.ts")],
        { cwd: process.cwd(), stdio: "inherit", env },
      ),
    );
}
if (
  !worker &&
  values.PRODUCT_PAYMENTS_ENABLED === "true" &&
  /^(sk|rk)_test_/.test(values.PRODUCT_STRIPE_SECRET_KEY ?? "")
) {
  children.push(
    spawn(
      process.execPath,
      [...runtimeArgs, resolve("workers/products/runner.ts"), "--watch"],
      { cwd: process.cwd(), stdio: "inherit", env },
    ),
  );
}
const args = worker
  ? [
      ...runtimeArgs,
      resolve("workers/products/runner.ts"),
      ...(process.argv.includes("--watch") ? ["--watch"] : []),
    ]
  : [
      `${app}/node_modules/next/dist/bin/next`,
      "dev",
      "--webpack",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3110",
    ];
const child = spawn(process.execPath, args, {
  cwd: worker ? process.cwd() : app,
  stdio: "inherit",
  env,
});
children.push(child);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => children.forEach((c) => c.kill(signal)));
child.on("exit", (code) => {
  children.filter((c) => c !== child).forEach((c) => c.kill("SIGTERM"));
  process.exitCode = code ?? 0;
});
