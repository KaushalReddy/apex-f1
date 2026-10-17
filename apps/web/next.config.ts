import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    // Exported race files change only on re-export: browsers keep them an hour and may reuse a stale copy for a week while refreshing.
    return [{ source: "/replay/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=604800" }] }];
  },
};
export default nextConfig;
