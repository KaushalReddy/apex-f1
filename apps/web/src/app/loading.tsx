import { PageContainer } from "@/components/ui/page-container";

export default function Loading() {
  return (
    <PageContainer>
      <div role="status" aria-live="polite" className="animate-pulse-soft">
        <span className="sr-only">Loading</span>
        <div aria-hidden="true" className="space-y-4">
          <div className="h-3 w-24 rounded-sm bg-surface-3" />
          <div className="h-9 w-2/3 max-w-xl rounded-sm bg-surface-3" />
          <div className="h-4 w-1/2 max-w-lg rounded-sm bg-surface-2" />
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-32 rounded-lg border border-line bg-surface" />
            ))}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
