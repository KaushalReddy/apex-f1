import Link from "next/link";
import { Chart, SERIES_A, SERIES_B } from "@/components/drivers/charts";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { compare } from "@/lib/drivers/compare";
import { loadSeasons } from "@/lib/drivers/load";

export const metadata = { title: "Compare drivers" };

type Props = { searchParams: Promise<{ season?: string; a?: string; b?: string }> };

const fmt = (v: number | null, kind: "int" | "dec" | "pos" | "pct") =>
  v == null ? "—" : kind === "pos" ? `P${v}` : kind === "pct" ? `${Math.round(v * 100)}%` : kind === "dec" ? v.toFixed(1) : String(v);

export default async function ComparePage({ searchParams }: Props) {
  const q = await searchParams;
  const { seasons } = await loadSeasons();
  const c = compare(seasons, q);
  const select = "h-10 w-full rounded-md border border-line-strong bg-surface-2 px-2 text-sm text-fg";

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Drivers"
        title="Compare drivers"
        description="Two drivers, one season, the same races. Head-to-head counts only events both took part in; metrics without data for either driver are not scored."
        badges={<Badge tone="info">Official classifications · OpenF1</Badge>}
        actions={
          <ButtonLink href="/drivers" variant="secondary" size="sm">
            All drivers
          </ButtonLink>
        }
      />
      {!c ? (
        <EmptyState title="No race results yet" status="Unavailable" headingLevel="h2">
          Comparisons need race results, which appear after the first classified race.
        </EmptyState>
      ) : (
        <>
          <form method="get" className="mb-5 grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto] sm:items-end">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Season</span>
              <select name="season" defaultValue={c.season} className={select}>
                {c.seasonOptions.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            {(["a", "b"] as const).map((k) => (
              <label key={k} className="flex flex-col gap-1 text-sm">
                <span className="text-muted">Driver {k.toUpperCase()}</span>
                <select name={k} defaultValue={c[k].slug} className={select}>
                  {c.lineup.map((d) => (
                    <option key={d.slug} value={d.slug}>
                      {d.name} ({d.acronym})
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <div className="flex gap-2">
              <Button type="submit" size="md">
                Compare
              </Button>
              <ButtonLink href={`/drivers/compare?season=${c.season}&a=${c.b.slug}&b=${c.a.slug}`} variant="secondary" size="md" aria-label="Swap drivers A and B">
                Swap
              </ButtonLink>
            </div>
          </form>
          {c.notices.length > 0 && (
            <ul className="mb-4 space-y-1 text-sm text-warning" role="status">
              {c.notices.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}

          <section aria-labelledby="pair-heading" className="overflow-hidden rounded-lg border border-line bg-surface">
            <h2 id="pair-heading" className="sr-only">
              {c.a.name} and {c.b.name}, {c.season}
            </h2>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch border-b border-line">
              {[c.a, null, c.b].map((d, i) =>
                d ? (
                  <div key={d.slug} className={`relative p-4 ${i === 2 ? "text-right" : ""}`}>
                    <span aria-hidden="true" className={`absolute inset-y-0 w-1 ${i === 2 ? "right-0" : "left-0"}`} style={{ backgroundColor: d.teamColour }} />
                    <p className="flex items-center gap-2 font-display text-3xl font-semibold leading-none tracking-[0.04em] sm:text-4xl" style={{ justifyContent: i === 2 ? "flex-end" : "flex-start" }}>
                      <span aria-hidden="true" className="inline-block size-2.5 rounded-full" style={{ backgroundColor: i === 0 ? SERIES_A : SERIES_B }} />
                      {d.acronym}
                    </p>
                    <p className="mt-1 text-sm font-medium">
                      <Link href={`/drivers/${d.slug}`} className="hover:text-accent-strong">
                        {d.name}
                      </Link>
                    </p>
                    <p className="text-xs text-muted">
                      {d.team ?? "—"}
                      {d.number != null && ` · #${d.number}`}
                    </p>
                  </div>
                ) : (
                  <div key="vs" className="flex items-center px-2 text-xs font-semibold uppercase tracking-wider text-subtle">
                    vs
                  </div>
                ),
              )}
            </div>
            <table className="w-full text-sm tabular-nums">
              <caption className="sr-only">Season metrics, {c.season}. The leading value in each row is marked “leads”.</caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">{c.a.name}</th>
                  <th scope="col">Metric</th>
                  <th scope="col">{c.b.name}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {c.metrics.map(({ context, ...m }) => (context ? { ...m, leader: "context" as const } : m)).map((m) => (
                  <tr key={m.label}>
                    <td className={`w-[38%] px-4 py-2 ${m.leader === "a" ? "font-semibold text-fg" : "text-muted"}`}>
                      {fmt(m.a, m.kind)}
                      {m.leader === "a" && <span className="ml-2 text-[11px] font-medium uppercase tracking-wider text-accent-strong">leads</span>}
                    </td>
                    <th scope="row" className="px-2 py-2 text-center text-[11px] font-medium uppercase tracking-wider text-subtle">
                      {m.label}
                      {m.leader === "tie" && <span className="block normal-case tracking-normal text-muted">level</span>}
                      {m.leader === null && <span className="block normal-case tracking-normal text-muted">not comparable (no value)</span>}
                    </th>
                    <td className={`w-[38%] px-4 py-2 text-right ${m.leader === "b" ? "font-semibold text-fg" : "text-muted"}`}>
                      {m.leader === "b" && <span className="mr-2 text-[11px] font-medium uppercase tracking-wider text-accent-strong">leads</span>}
                      {fmt(m.b, m.kind)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section aria-labelledby="h2h-heading" className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-line bg-surface p-4">
              <h2 id="h2h-heading" className="eyebrow">
                Head-to-head · {c.season}
              </h2>
              <dl className="mt-3 grid grid-cols-2 gap-4 tabular-nums">
                <div>
                  <dt className="text-xs text-muted">Race finishes ({c.h2h.race.events} common races)</dt>
                  <dd className="mt-1 font-display text-3xl font-semibold">
                    {c.h2h.race.a} – {c.h2h.race.b}
                  </dd>
                  {c.h2h.race.undecided > 0 && <p className="text-xs text-subtle">{c.h2h.race.undecided} with neither classified (not scored)</p>}
                </div>
                <div>
                  <dt className="text-xs text-muted">Qualifying ({c.h2h.quali.events} common sessions)</dt>
                  <dd className="mt-1 font-display text-3xl font-semibold">
                    {c.h2h.quali.a} – {c.h2h.quali.b}
                  </dd>
                </div>
              </dl>
              {(c.h2h.onlyA > 0 || c.h2h.onlyB > 0) && (
                <p className="mt-3 text-xs text-muted">
                  Not scored: {c.h2h.onlyA} race{c.h2h.onlyA === 1 ? "" : "s"} only {c.a.acronym} took part in, {c.h2h.onlyB} only {c.b.acronym} took part in.
                </p>
              )}
              {c.teammates && <p className="mt-2 text-xs text-muted">Teammates this season: same car, so head-to-head is the most direct comparison here.</p>}
            </div>
            <div className="rounded-lg border border-line bg-surface p-4 text-xs leading-relaxed text-muted">
              <h2 className="eyebrow">How the comparison works</h2>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                <li>Same season for both drivers; season metrics use only that season.</li>
                <li>Race head-to-head: races both started. Both classified: better position wins. One classified: the classified driver wins. Neither: not scored.</li>
                <li>Qualifying head-to-head: sessions where both have a qualifying position; positions are unique, so there are no ties.</li>
                <li>“Not comparable” means one driver has no value (for example no classified finish); missing data is never counted as a loss.</li>
                <li>Different numbers of starts are shown, not adjusted for: rates (finish rate, points per start) are the fairer read.</li>
              </ul>
            </div>
          </section>

          <section className="mt-4">
            <Chart
              title={`Championship points · ${c.season}`}
              summary={`Published points after each race for ${c.a.acronym} and ${c.b.acronym}. Gaps mean no published standing for that driver after that race.${c.skipped.length ? ` No classification was published for ${c.skipped.join(" and ")}; not counted.` : ""}`}
              xLabels={c.progression.map((p) => p.code)}
              xNames={c.progression.map((p) => p.name.replace(" Grand Prix", " GP"))}
              valueLabel="points"
              series={[
                { id: "a", label: c.a.acronym, color: SERIES_A, values: c.progression.map((p) => p.a) },
                { id: "b", label: c.b.acronym, color: SERIES_B, values: c.progression.map((p) => p.b) },
              ]}
            />
          </section>
        </>
      )}
    </PageContainer>
  );
}
