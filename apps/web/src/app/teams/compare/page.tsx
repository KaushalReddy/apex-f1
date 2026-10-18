import Link from "next/link";
import { Chart, SERIES_A, SERIES_B } from "@/components/drivers/charts";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { loadSeasons } from "@/lib/drivers/load";
import { compareTeams } from "@/lib/teams/compare";

export const metadata = { title: "Compare teams" };

type Props = { searchParams: Promise<{ season?: string; a?: string; b?: string }> };

const fmt = (v: number | null, kind: "int" | "dec" | "pos" | "pct") =>
  v == null ? "—" : kind === "pos" ? `P${v}` : kind === "pct" ? `${Math.round(v * 100)}%` : kind === "dec" ? v.toFixed(1) : String(v);

export default async function CompareTeamsPage({ searchParams }: Props) {
  const { seasons } = await loadSeasons();
  const c = compareTeams(seasons, await searchParams);
  const select = "h-10 w-full rounded-md border border-line-strong bg-surface-2 px-2 text-sm text-fg";

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Teams"
        title="Compare teams"
        description="Two constructors, one season, the same events. Event head-to-head counts only events both entered; a metric without a value for either team is not scored."
        badges={<Badge tone="info">Official classifications · OpenF1</Badge>}
        actions={
          <ButtonLink href="/teams" variant="secondary" size="sm">
            All teams
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
                <span className="text-muted">Team {k.toUpperCase()}</span>
                <select name={k} defaultValue={c[k].slug} className={select}>
                  {c.teams.map((t) => (
                    <option key={t.slug} value={t.slug}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="md">
                Compare
              </Button>
              <ButtonLink href={`/teams/compare?season=${c.season}&a=${c.b.slug}&b=${c.a.slug}`} variant="secondary" size="md" aria-label="Swap teams A and B">
                Swap
              </ButtonLink>
              <ButtonLink href="/teams/compare" variant="ghost" size="md">
                Reset
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
              {[c.a, null, c.b].map((t, i) =>
                t ? (
                  <div key={t.slug} className={`relative p-4 ${i === 2 ? "text-right" : ""}`}>
                    <span aria-hidden="true" className={`absolute inset-y-0 w-1 ${i === 2 ? "right-0" : "left-0"}`} style={{ backgroundColor: t.colour }} />
                    <p className="flex items-center gap-2 font-display text-2xl font-semibold leading-none sm:text-4xl" style={{ justifyContent: i === 2 ? "flex-end" : "flex-start" }}>
                      <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-full" style={{ backgroundColor: i === 0 ? SERIES_A : SERIES_B }} />
                      <Link href={`/teams/${t.slug}?season=${c.season}`} className="hover:text-accent-strong">
                        {t.name}
                      </Link>
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {t.racedAs && `Raced as ${t.racedAs} · `}
                      {t.lineup.slice(0, 2).map((d) => d.acronym).join(" / ")}
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
                {c.metrics.map((m) => (
                  <tr key={m.label}>
                    <td className={`w-[38%] px-4 py-2 ${m.leader === "a" ? "font-semibold text-fg" : "text-muted"}`}>
                      {fmt(m.a, m.kind)}
                      {m.leader === "a" && <span className="ml-2 text-[11px] font-medium uppercase tracking-wider text-accent-strong">leads</span>}
                    </td>
                    <th scope="row" className="px-2 py-2 text-center text-[11px] font-medium uppercase tracking-wider text-subtle">
                      {m.label}
                      {m.leader === "tie" && <span className="block normal-case tracking-normal text-muted">level</span>}
                      {m.leader === null && !m.context && <span className="block normal-case tracking-normal text-muted">not comparable (no value)</span>}
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

          <section aria-labelledby="h2h-heading" className="mt-4 grid gap-3 lg:grid-cols-3">
            <div className="rounded-lg border border-line bg-surface p-4">
              <h2 id="h2h-heading" className="eyebrow">
                Event head-to-head · {c.season}
              </h2>
              <p className="mt-3 font-display text-3xl font-semibold tabular-nums">
                {c.events.a} – {c.events.b}
              </p>
              <p className="text-xs text-muted">
                More team points at the event, over {c.events.compared} events both entered
                {c.events.tie > 0 && ` · ${c.events.tie} level (same points)`}
              </p>
              {(c.events.onlyA > 0 || c.events.onlyB > 0) && (
                <p className="mt-2 text-xs text-muted">
                  Not scored: {c.events.onlyA} event{c.events.onlyA === 1 ? "" : "s"} only {c.a.name} entered, {c.events.onlyB} only {c.b.name} entered.
                </p>
              )}
            </div>
            <div className="rounded-lg border border-line bg-surface p-4">
              <h2 className="eyebrow">Driver contributions</h2>
              <div className="mt-2 grid grid-cols-2 gap-4 text-sm tabular-nums">
                {[c.a, c.b].map((t) => (
                  <ul key={t.slug} className="space-y-1">
                    {t.lineup.map((d) => (
                      <li key={d.acronym} className="flex justify-between gap-2">
                        {d.slug ? (
                          <Link href={`/drivers/${d.slug}`} className="font-medium hover:text-accent-strong">
                            {d.acronym}
                          </Link>
                        ) : (
                          <span className="font-medium">{d.acronym}</span>
                        )}
                        <span className="text-muted">
                          {d.points} pts · {d.starts} st.
                        </span>
                      </li>
                    ))}
                  </ul>
                ))}
              </div>
              <p className="mt-2 text-xs text-subtle">Points scored for that team (race + sprint) and starts for it.</p>
            </div>
            <div className="rounded-lg border border-line bg-surface p-4 text-xs leading-relaxed text-muted">
              <h2 className="eyebrow">How the comparison works</h2>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                <li>Same season for both teams; season names are the ones published that season.</li>
                <li>Event head-to-head: events both entered; more team points wins, equal points (including both on zero) is level.</li>
                <li>Championship position and points are published standings; the other rows are derived from classifications.</li>
                <li>“Not comparable” means one team has no value; missing data is never counted as a loss. No overall winner is declared.</li>
              </ul>
            </div>
          </section>

          <section className="mt-4">
            <Chart
              title={`Constructors' points · ${c.season}`}
              summary={`Published points after each race for ${c.a.name} and ${c.b.name}. Gaps mean no published standing after that race.${c.skipped.length ? ` No classification was published for ${c.skipped.join(" and ")}; not counted.` : ""}`}
              xLabels={c.progression.map((p) => p.code)}
              xNames={c.progression.map((p) => p.name.replace(" Grand Prix", " GP"))}
              valueLabel="points"
              series={[
                { id: "a", label: c.a.name, color: SERIES_A, values: c.progression.map((p) => p.a) },
                { id: "b", label: c.b.name, color: SERIES_B, values: c.progression.map((p) => p.b) },
              ]}
            />
          </section>
        </>
      )}
    </PageContainer>
  );
}
