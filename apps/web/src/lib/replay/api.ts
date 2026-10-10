import type { PositionFrame } from "./types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

export async function fetchReplayTimeline(
  sessionKey: number,
  from: number,
  to: number,
): Promise<PositionFrame[]> {
  const url = new URL(
    `/api/sessions/${sessionKey}/replay/timeline`,
    API_BASE_URL,
  );

  url.searchParams.set("from", String(from));
  url.searchParams.set("to", String(to));

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Replay API request failed: ${response.status} ${response.statusText}`,
    );
  }

  return response.json() as Promise<PositionFrame[]>;
}
