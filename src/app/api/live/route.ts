import type { NextRequest } from "next/server";
import { getTenant } from "@/server/auth";
import { registerStream, subscribeLive } from "@/server/live";

/**
 * The live channel for signed-in staff: a text/event-stream that carries only "something changed" signals for the
 * person's own business and current branch. Without a session it answers 401 and nothing is held open.
 */
export async function GET(request: NextRequest) {
  const ctx = await getTenant();
  if (!ctx) return new Response("Sign in first.", { status: 401 });

  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          close();
        }
      };
      const unsubscribe = subscribeLive((e) => {
        if (e.businessId !== ctx.businessId) return;
        if (e.branchId && e.branchId !== ctx.branchId) return;
        send(`event: change\ndata: ${JSON.stringify({ topic: e.topic })}\n\n`);
      });
      // A comment line every 20 seconds keeps phones and proxies from closing an idle stream.
      const beat = setInterval(() => send(": keep-alive\n\n"), 20_000);
      const release = registerStream(ctx.userId, () => close());
      function close() {
        if (closed) return;
        closed = true;
        clearInterval(beat);
        unsubscribe();
        release();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
      cleanup = close;
      request.signal.addEventListener("abort", close);
      send("retry: 3000\nevent: hello\ndata: {}\n\n");
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform stops compression from holding the stream back; X-Accel-Buffering does the same behind nginx.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
