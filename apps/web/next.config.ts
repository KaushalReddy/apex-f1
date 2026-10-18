import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Resolve metadata before the first byte for every client (not only bots): pages that render on demand (a race or driver synced after
  // the build) can then answer an unknown key with the full not-found page in the HTML, not a shell completed in the browser.
  htmlLimitedBots: /.*/,
  async headers() {
    // Exported race files change only on re-export: browsers keep them an hour and may reuse a stale copy for a week while refreshing.
    return [{ source: "/replay/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=604800" }] }];
  },
};
export default nextConfig;
