import { ANALYSIS_HUB, PRIMARY_NAV, PRODUCT_NAV } from "@/domain/navigation";
import { Brand } from "./brand";
import { LiveIndicator } from "./live-indicator";
import { MobileNav } from "./mobile-nav";
import { NavLink } from "./nav-link";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg">
      <div className="relative mx-auto flex h-14 max-w-[88rem] items-center gap-8 px-4 sm:px-6 lg:px-8">
        <Brand />
        <nav aria-label="Primary" className="hidden lg:block">
          <ul className="flex items-stretch gap-1">
            {PRIMARY_NAV.map((i) => (
              <li key={i.href} className="flex">
                <NavLink href={i.href} label={i.label} variant="primary" />
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <LiveIndicator />
          <MobileNav />
        </div>
      </div>
      <div className="hidden border-t border-line bg-surface lg:block">
        <nav aria-label="Analysis" className="mx-auto max-w-[88rem] px-4 sm:px-6 lg:px-8">
          <ul className="flex h-10 items-stretch gap-1">
            {/* Analysis is a real link (an index of the tools). It used to be a bare label, which looked like a nav item but showed no pointer. */}
            <li className="mr-1 flex items-center border-r border-line pr-2">
              <NavLink href={ANALYSIS_HUB.href} label={ANALYSIS_HUB.label} variant="secondary" />
            </li>
            {PRODUCT_NAV.map((i) => (
              <li key={i.href} className="flex">
                <NavLink href={i.href} label={i.label} variant="secondary" />
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
