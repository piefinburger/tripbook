import { currentUser, requireMember } from "@/lib/auth";
import { subscribe } from "@/lib/events";

export const dynamic = "force-dynamic";

// Server-sent events stream. Viewers included: live updates are the whole
// point of the viewer role. Heartbeat keeps proxies from timing the
// connection out; the client auto-reconnects (EventSource semantics).
export async function GET(_req, { params }) {
  const u = await currentUser();
  if (!u) return new Response("unauthorized", { status: 401 });
  const role = await requireMember(params.id, u.id).catch(r => r);
  if (role instanceof Response) return role;

  const encoder = new TextEncoder();
  let cleanup = () => {}, beat;
  const stream = new ReadableStream({
    start(controller) {
      const c = {
        enqueue: (s) => controller.enqueue(encoder.encode(s))
      };
      c.enqueue(`data: ${JSON.stringify({ type: "hello" })}\n\n`);
      const un = subscribe(params.id, c);
      beat = setInterval(() => {
        try { c.enqueue(`: hb\n\n`); } catch { /* closed */ }
      }, 25000);
      cleanup = () => { clearInterval(beat); un(); };
    },
    cancel() { cleanup(); }
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
