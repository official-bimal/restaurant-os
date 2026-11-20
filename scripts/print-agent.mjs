#!/usr/bin/env node
/**
 * A starting point for the small program that sits next to a receipt printer. It asks the app "anything to print?", sends the
 * printer bytes to a network printer (raw port 9100, which most Ethernet and Wi-Fi thermal printers listen on), and reports back.
 *
 *   APP_URL=http://192.168.1.66:3000 PRINT_KEY=pk_... PRINTER_HOST=192.168.1.50 node scripts/print-agent.mjs
 *
 * Optional: PRINTER_ID (the id shown for this printer under Printing, Printers: the app then sends only the slips routed to it and shows
 * it as connected), PRINTER_PORT (default 9100), BRANCH_ID (only that branch's jobs, when PRINTER_ID is not set), POLL_SECONDS (default 3).
 *
 * NOT YET TRIED ON A REAL PRINTER. It follows the common raw-printing convention and the app's documented job format, but printers
 * differ (some need a different port, a USB or serial connection, or a code page). Treat it as a working outline to adjust on the
 * first real test. For a USB printer, replace `sendToPrinter` with a write to the printer's device or an OS print command.
 */
import net from "node:net";

const APP_URL = (process.env.APP_URL ?? "").replace(/\/$/, "");
const KEY = process.env.PRINT_KEY ?? "";
const HOST = process.env.PRINTER_HOST ?? "";
const PORT = Number(process.env.PRINTER_PORT ?? 9100);
const BRANCH = process.env.BRANCH_ID ?? "";
const PRINTER = process.env.PRINTER_ID ?? "";
const POLL_MS = Math.max(1, Number(process.env.POLL_SECONDS ?? 3)) * 1000;

if (!APP_URL || !KEY || !HOST) {
  console.error("Set APP_URL, PRINT_KEY and PRINTER_HOST. See the comment at the top of this file.");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

function sendToPrinter(bytes) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: HOST, port: PORT }, () => socket.end(bytes));
    socket.setTimeout(10_000, () => socket.destroy(new Error("printer did not answer")));
    socket.on("close", (hadError) => (hadError ? reject(new Error("could not print")) : resolve()));
    socket.on("error", reject);
  });
}

async function report(id, ok, error) {
  await fetch(`${APP_URL}/api/print/agent/jobs/${encodeURIComponent(id)}`, { method: "POST", headers, body: JSON.stringify({ ok, error }) }).catch(() => {});
}

async function tick() {
  let jobs = [];
  try {
    const res = await fetch(`${APP_URL}/api/print/agent/jobs${PRINTER ? `?printer=${encodeURIComponent(PRINTER)}` : BRANCH ? `?branch=${encodeURIComponent(BRANCH)}` : ""}`, { headers });
    if (res.status === 401) throw new Error("The printer key was refused. Make a new key under Printing in the app.");
    if (res.status === 404) throw new Error("The app does not know this PRINTER_ID. Copy it from Printing, Printers.");
    if (!res.ok) throw new Error(`The app answered ${res.status}`);
    jobs = (await res.json()).jobs ?? [];
  } catch (e) {
    console.error(new Date().toISOString(), "could not reach the app:", e.message);
    return;
  }
  for (const job of jobs) {
    try {
      await sendToPrinter(Buffer.from(job.escposBase64, "base64"));
      await report(job.id, true);
      console.log(new Date().toISOString(), "printed", job.kind, job.id);
    } catch (e) {
      await report(job.id, false, e.message);
      console.error(new Date().toISOString(), "print failed:", e.message);
    }
  }
}

console.log(`Print agent running: ${APP_URL} -> ${HOST}:${PORT}`);
setInterval(tick, POLL_MS);
void tick();
