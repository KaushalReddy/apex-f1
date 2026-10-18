import { createReadStream } from "node:fs";
import type { Readable } from "node:stream";
import { constants, createBrotliCompress, createGzip } from "node:zlib";
import { loadReplayIndex, replayFile } from "@/lib/replay/load";

/**
 * GET /api/replay/<sessionKey>: one race's dataset, from the synced copy when there is one (tools/openf1-sync), else the bundled one.
 * Streamed (files are ~2.5 MB) and compressed here (Brotli or gzip, ~0.5-0.8 MB; Next.js does not compress a streamed route response); an
 * ETag from size and modification time lets browsers skip unchanged files. Runs per request so races
 * synced after the build are served without a redeploy.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ session: string }> }) {
  const key = (await params).session;
  if (!/^\d+$/.test(key)) return Response.json({ error: "invalid session" }, { status: 400 });
  const entry = (await loadReplayIndex()).find((r) => String(r.sessionKey) === key);
  const f = entry ? await replayFile(entry.season, entry.sessionKey) : null;
  if (!f) return Response.json({ error: "no replay for this session" }, { status: 404 });
  const etag = `"${f.size.toString(36)}-${Math.round(f.mtimeMs).toString(36)}"`;
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=3600, stale-while-revalidate=604800",
    etag,
    "x-apex-data-origin": f.origin,
    vary: "accept-encoding",
  };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  const accept = req.headers.get("accept-encoding") ?? "";
  const file = createReadStream(f.file);
  // Brotli at a fast quality (smaller than gzip at similar speed), else gzip, else as is.
  const [encoding, body] = /\bbr\b/.test(accept)
    ? ["br", file.pipe(createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_SIZE_HINT]: f.size } }))]
    : /\bgzip\b/.test(accept)
      ? ["gzip", file.pipe(createGzip({ level: 6 }))]
      : [null, file];
  return new Response(toWebStream(body, [file, body]), { headers: { ...headers, ...(encoding ? { "content-encoding": encoding } : { "content-length": String(f.size) }) } });
}

/**
 * Node stream -> web stream with backpressure (pause while the browser is behind) and clean cancellation: when the browser goes away
 * mid-download (leaving the page), reading stops and nothing is written to the closed stream. Readable.toWeb over a piped zlib stream
 * threw "Controller is already closed" as an uncaught exception in that case.
 */
function toWebStream(source: Readable, all: Readable[]): ReadableStream<Uint8Array> {
  let closed = false;
  const stop = () => {
    closed = true;
    for (const s of all) s.destroy();
  };
  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      source.on("data", (chunk: Buffer) => {
        if (closed) return;
        ctrl.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
        if ((ctrl.desiredSize ?? 1) <= 0) source.pause();
      });
      source.on("end", () => {
        if (closed) return;
        closed = true;
        ctrl.close();
      });
      source.on("error", (e) => {
        if (closed) return;
        stop();
        ctrl.error(e);
      });
    },
    pull() {
      source.resume();
    },
    cancel() {
      stop();
    },
  });
}
