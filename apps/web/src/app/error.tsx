"use client";

import { Button, ButtonLink } from "@/components/ui/button";
import { PageContainer } from "@/components/ui/page-container";
import { Panel } from "@/components/ui/panel";

export default function ErrorState({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageContainer>
      <Panel as="section" aria-labelledby="error-heading" className="max-w-xl">
        <p className="eyebrow">Error</p>
        <h1 id="error-heading" className="mt-2 text-2xl font-semibold tracking-tight">
          Something went off track
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          This page failed to load. You can try again or head back to the start.
        </p>
        {error.digest && <p className="mt-3 font-mono text-xs text-subtle">Reference: {error.digest}</p>}
        <div className="mt-6 flex gap-3">
          <Button onClick={reset}>Try again</Button>
          <ButtonLink href="/" variant="secondary">
            Back to home
          </ButtonLink>
        </div>
      </Panel>
    </PageContainer>
  );
}
