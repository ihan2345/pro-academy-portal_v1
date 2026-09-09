interface Env {
  APP_URL: string;
  CRON_SECRET: string;
}
export default {
  async scheduled(
    _event: unknown,
    env: Env,
    ctx: { waitUntil(p: Promise<unknown>): void },
  ) {
    ctx.waitUntil(
      (async () => {
        const response = await fetch(`${env.APP_URL}/api/cron`, {
          method: "POST",
          headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
          signal: AbortSignal.timeout(55000),
        });
        if (!response.ok)
          throw new Error(`Portal jobs failed: ${response.status}`);
      })(),
    );
  },
};
