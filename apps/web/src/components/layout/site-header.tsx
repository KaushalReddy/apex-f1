import { PRIMARY_NAV, PRODUCT_NAV } from "@/domain/navigation";
import { Brand } from "./brand";
import { LiveIndicator } from "./live-indicator";
import { MobileNav } from "./mobile-nav";
import { NavLink } from "./nav-link";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg">
      <div className="relative mx-auto flex h-14 max-w-[88rem] items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Brand />
        <nav aria-label="Primary" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {PRIMARY_NAV.map((i) => (
              <li key={i.href}>
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
        <nav aria-label="Product areas" className="mx-auto flex h-10 max-w-[88rem] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <span className="eyebrow pr-2">Analysis</span>
          <ul className="flex items-center gap-1">
            {PRODUCT_NAV.map((i) => (
              <li key={i.href}>
                <NavLink href={i.href} label={i.label} variant="secondary" />
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
