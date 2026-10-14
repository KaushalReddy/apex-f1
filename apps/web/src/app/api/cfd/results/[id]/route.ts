import { getResult } from "@/lib/cfd/server";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await getResult((await params).id);
  return r ? Response.json(r) : Response.json({ error: "not found" }, { status: 404 });
}
