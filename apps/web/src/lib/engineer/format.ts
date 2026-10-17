/**
 * The small Markdown subset the engineer writes, parsed to data (never to HTML, so model output cannot inject markup): paragraphs,
 * "-"/"*"/"1." lists, **bold**, and moment links [label](#t=<replay ms>). Anything else stays plain text.
 */
export type Inline = { kind: "text"; text: string } | { kind: "bold"; text: string } | { kind: "moment"; text: string; t: number };
export type Block = { kind: "p"; parts: Inline[] } | { kind: "ul" | "ol"; items: Inline[][] };

const INLINE = /\*\*(.+?)\*\*|\[([^\]]+)\]\(#t=(-?\d+(?:\.\d+)?)\)/g;

export function inline(s: string): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  for (const m of s.matchAll(INLINE)) {
    if (m.index > at) out.push({ kind: "text", text: s.slice(at, m.index) });
    out.push(m[1] != null ? { kind: "bold", text: m[1] } : { kind: "moment", text: m[2], t: Number(m[3]) });
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push({ kind: "text", text: s.slice(at) });
  return out;
}

export function blocks(md: string): Block[] {
  const out: Block[] = [];
  for (const chunk of md.replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = chunk.split("\n").filter((l) => l.trim());
    if (!lines.length) continue;
    let para: string[] = [];
    const flush = () => {
      if (para.length) out.push({ kind: "p", parts: inline(para.join(" ").replace(/^#+\s*/, "")) });
      para = [];
    };
    for (const l of lines) {
      const ul = l.match(/^\s*[-*]\s+(.*)$/);
      const ol = l.match(/^\s*\d+[.)]\s+(.*)$/);
      const item = ul ?? ol;
      if (!item) {
        para.push(l.trim());
        continue;
      }
      flush();
      const kind = ul ? "ul" : "ol";
      const last = out.at(-1);
      if (last && last.kind === kind) last.items.push(inline(item[1]));
      else out.push({ kind, items: [inline(item[1])] });
    }
    flush();
  }
  return out;
}
