import Link from "next/link";
import { ALL_NAV_LINKS } from "@/domain/navigation";
import { Brand } from "./brand";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-[88rem] gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.2fr_2fr] lg:px-8">
        <div>
          <Brand />
          <p className="mt-4 text-sm text-muted">Experience every lap.</p>
        </div>
        <nav aria-label="Footer">
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            {ALL_NAV_LINKS.map((i) => (
              <li key={i.href}>
                <Link href={i.href} className="motion-interactive inline-flex min-h-9 items-center text-muted hover:text-fg">
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-[88rem] px-4 py-5 text-xs leading-relaxed text-subtle sm:px-6 lg:px-8">
          APEX F1 is an independent project. It is not affiliated with, endorsed by or connected to Formula 1, the FIA or any team. Content marked
          &ldquo;static preview&rdquo; is placeholder material, not live data.
        </p>
      </div>
    </footer>
  );
}
