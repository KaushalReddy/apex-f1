import { ButtonLink } from "@/components/ui/button";
import { PageContainer } from "@/components/ui/page-container";
import { PRIMARY_NAV } from "@/domain/navigation";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <PageContainer>
      <p className="eyebrow">Error 404</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-3 max-w-xl text-base leading-relaxed text-muted">
        That page does not exist, or it has not been built yet. Try one of the main areas below.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href="/">Home</ButtonLink>
        {PRIMARY_NAV.slice(0, 3).map((i) => (
          <ButtonLink key={i.href} href={i.href} variant="secondary">
            {i.label}
          </ButtonLink>
        ))}
      </div>
    </PageContainer>
  );
}
