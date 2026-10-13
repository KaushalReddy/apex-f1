/** Affordance for clickable cards: a small arrow that is quiet at rest and brightens and nudges on hover/focus. Decorative. */
export function CardArrow() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="size-4 shrink-0 text-subtle transition-[transform,color] duration-[var(--duration-fast)] ease-[var(--ease-apex)] group-hover:translate-x-0.5 group-hover:text-accent-strong group-focus-visible:text-accent-strong"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

/** Shared class string for clickable cards so every card behaves identically. */
export const CARD_LINK =
  "group motion-interactive block rounded-lg border border-line bg-surface p-5 hover:border-line-strong hover:bg-surface-2";
