import { Badge, DemoBadge } from "./badge";
import { ButtonLink } from "./button";
import { PageContainer } from "./page-container";
import { PageHeader } from "./page-header";
import { Panel } from "./panel";

/** Honest "nothing to show here yet" state for a page whose data is missing: says why in plain words; never shows fake data. */
export function ComingSoon({
  eyebrow,
  title,
  description,
  reason,
  back,
  preview,
}: {
  eyebrow: string;
  title: string;
  description: string;
  /** Plain-language explanation of what is missing. */
  reason: string;
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
            <Badge tone="neutral">Not available</Badge>
            {preview && <DemoBadge />}
          </>
        }
      />
      <Panel as="section" aria-labelledby="coming-heading" className="max-w-3xl">
        <h2 id="coming-heading" className="font-display text-2xl font-semibold tracking-[0.01em]">
          Nothing to show yet
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{reason}</p>
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
