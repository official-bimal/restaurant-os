/**
 * Runs once when the server starts. It starts the timer for automatic campaigns (birthday and win-back), which checks every
 * 15 minutes whether a rule has something to do. A rule only acts when an owner or manager switched it on, only between 9am
 * and 8pm in the business's own time, and at most once a day, so checking often is harmless. Set AUTOMATION_TIMER=off to
 * disable the timer (for example if you call /api/cron/automations from a real scheduler instead).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.AUTOMATION_TIMER === "off") return;
  const g = globalThis as unknown as { __rosAutomationTimer?: ReturnType<typeof setInterval> };
  if (g.__rosAutomationTimer) return;

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      // Online orders nobody answered in time expire, so the customer is told instead of waiting for ever.
      const { expireStaleOnlineOrders } = await import("@/features/online/server/service");
      const expired = await expireStaleOnlineOrders();
      if (expired) console.log(`[online] ${expired} unanswered online order${expired === 1 ? "" : "s"} expired`);
      // Paid bills still waiting to reach Customer OS (it was down, or there was no internet): try again.
      const { flushAll } = await import("@/features/customeros/server/outbox");
      const sentToCustomerOs = await flushAll();
      for (const [business, r] of Object.entries(sentToCustomerOs)) console.log(`[customeros] ${business.slice(0, 6)}: sent ${r.sent}, waiting ${r.waiting}, failed ${r.failed}`);
      const { runOwnerChecks } = await import("@/features/owner/server/owner");
      for (const r of await runOwnerChecks()) {
        if (r.newAlerts || r.summarySent) console.log(`[owner] new alerts ${r.newAlerts}${r.summarySent ? ", daily summary sent" : ""}`);
      }
      const { runAutomations } = await import("@/features/campaigns/server/automation");
      const results = await runAutomations();
      for (const r of results) {
        if (r.prepared || r.sent || r.failed) console.log(`[automation] ${r.kind}: prepared ${r.prepared}, sent ${r.sent}, failed ${r.failed}${r.note ? ` (${r.note})` : ""}`);
      }
    } catch (e) {
      console.error("[automation] run failed", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
  const every = 15 * 60 * 1000;
  g.__rosAutomationTimer = setInterval(tick, every);
  g.__rosAutomationTimer.unref?.();
  // First look a minute after start, not during start-up.
  setTimeout(tick, 60_000).unref?.();
}
