import { Badge, DemoBadge } from "./badge";
import { ButtonLink } from "./button";
import { PageContainer } from "./page-container";
import { PageHeader } from "./page-header";
import { Panel } from "./panel";
import { StatusDot } from "./status-dot";

/** Honest "not built yet" state. Shows what is planned and when; never fake data. */
export function ComingSoon({
  eyebrow,
  title,
  description,
  phase,
  planned,
  back,
  preview,
}: {
  eyebrow: string;
  title: string;
  description: string;
  phase: number;
  planned: readonly string[];
  back?: { href: string; label: string };
  preview?: boolean;
}) {
  return (
    <PageContainer>
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        badges={
          <>
            <Badge tone="info">Phase {phase}</Badge>
            {preview && <DemoBadge />}
          </>
        }
      />
      <Panel as="section" aria-labelledby="coming-heading" className="max-w-3xl">
        <div className="flex items-center gap-3">
          <StatusDot tone="warning" />
          <h2 id="coming-heading" className="text-lg font-semibold">
            Not available yet
          </h2>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          This area is part of the platform plan and is scheduled for Phase {phase}. Nothing on this page is live or simulated.
        </p>
        <h3 className="eyebrow mt-6">Planned</h3>
        <ul className="mt-3 space-y-2 text-sm text-fg">
          {planned.map((p) => (
            <li key={p} className="flex gap-3">
              <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-accent" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
        {back && (
          <div className="mt-8">
            <ButtonLink href={back.href} variant="secondary" size="sm">
              {back.label}
            </ButtonLink>
          </div>
        )}
      </Panel>
    </PageContainer>
  );
}
