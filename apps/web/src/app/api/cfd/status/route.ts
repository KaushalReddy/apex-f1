import { runnerState } from "@/lib/cfd/server";

export const dynamic = "force-dynamic";

/** Whether this server can run solver jobs, and what is running. */
export function GET() {
  return Response.json(runnerState());
}
