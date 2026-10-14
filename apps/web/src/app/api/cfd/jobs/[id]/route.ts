import { cancel, jobStatus } from "@/lib/cfd/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const s = await jobStatus((await params).id);
  return s ? Response.json(s) : Response.json({ error: "not found" }, { status: 404 });
}

/** Cancels a queued or running job. */
export async function DELETE(_: Request, { params }: Ctx) {
  return (await cancel((await params).id)) ? Response.json({ ok: true }) : Response.json({ error: "not running" }, { status: 409 });
}
