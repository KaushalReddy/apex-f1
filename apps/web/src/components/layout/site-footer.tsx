import Link from "next/link";
import { ALL_NAV_LINKS } from "@/domain/navigation";
import { Brand } from "./brand";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-[88rem] gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.2fr_2fr] lg:px-8">
        <div>
          <Brand />
          <p className="mt-4 max-w-xs text-sm text-muted">Race intelligence for fans who watch the gaps, not just the order.</p>
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
          APEX F1 is an independent project, not affiliated with, endorsed by or connected to Formula 1, the FIA or any team. Timing data comes
          from{" "}
          <a href="https://openf1.org" className="underline decoration-line underline-offset-2 hover:text-muted" rel="noopener noreferrer" target="_blank">
            OpenF1
          </a>
          , an unofficial community API. Calculated values, simulations and AI answers are labelled where they appear.
        </p>
      </div>
    </footer>
  );
}
