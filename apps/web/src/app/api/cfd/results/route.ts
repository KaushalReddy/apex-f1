import { localSummaries, shippedSummaries } from "@/lib/cfd/server";

export const dynamic = "force-dynamic";

/** Result summaries (no field arrays): those shipped with the app and those computed on this machine. */
export async function GET() {
  return Response.json({ shipped: await shippedSummaries(), local: await localSummaries() });
}
