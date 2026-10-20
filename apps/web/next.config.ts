import type { NextConfig } from "next";

// Baseline protections for every response: no MIME sniffing, no framing by other sites (clickjacking), no full URLs leaked to other
// origins, no device APIs, and HTTPS only once served over it. No CSP: the 3D views need inline Next.js scripts, blob workers and WebGL.
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Resolve metadata before the first byte for every client (not only bots): pages that render on demand (a race or driver synced after
  // the build) can then answer an unknown key with the full not-found page in the HTML, not a shell completed in the browser.
  htmlLimitedBots: /.*/,
  async headers() {
    // Exported race files change only on re-export: browsers keep them an hour and may reuse a stale copy for a week while refreshing.
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: "/replay/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=604800" }] },
    ];
  },
};
export default nextConfig;
