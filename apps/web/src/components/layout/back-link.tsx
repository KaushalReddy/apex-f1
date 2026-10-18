"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

/** The page one level up: /drivers/russell -> /drivers, /drivers -> /. */
export const parentPath = (pathname: string) => pathname.replace(/\/+$/, "").replace(/\/[^/]*$/, "") || "/";

// This tab's pages on the site, oldest first (kept by BackLink, which the root layout always mounts): a step back pops one, so Back
// never leaves the site after the browser's own back button.
const trail: string[] = [];

/** True when the previous page in this tab was on this site, so the browser's back returns to it. */
export const cameFromSite = () => trail.length > 1 || (document.referrer.startsWith(window.location.origin) && window.history.length > 1);

/**
 * "Back" on every page but home. Returns to the previous page when it was on this site (browser history, so scroll and filters come
 * back too); otherwise, e.g. a page opened from a search result, goes one level up. A plain link without JavaScript.
 */
export function BackLink() {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (pathname === trail.at(-1)) return;
    if (pathname === trail.at(-2)) trail.pop();
    else trail.push(pathname);
  }, [pathname]);
  if (pathname === "/") return null;
  const parent = parentPath(pathname);
  return (
    <div className="mx-auto -mb-6 w-full max-w-[88rem] px-4 pt-6 sm:px-6 lg:-mb-8 lg:px-8">
      <Link
        href={parent}
        onClick={(e) => {
          if (!cameFromSite() || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          router.back();
        }}
        className="motion-interactive -ml-2 inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted hover:bg-white/5 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 10H4m5-5-5 5 5 5" />
        </svg>
        Back
      </Link>
    </div>
  );
}
