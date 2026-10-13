import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md";

// Primary is the only red-filled control: use it once per view for the main action. Text on it is dark (white would be 3.7:1).
const base =
  "motion-interactive inline-flex select-none items-center justify-center gap-2 rounded-md font-semibold tracking-[0.01em] active:translate-y-px disabled:pointer-events-none disabled:opacity-45";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-strong",
  secondary: "border border-line-strong bg-surface-2 text-fg hover:border-muted/50 hover:bg-surface-3",
  ghost: "text-muted hover:bg-surface-2 hover:text-fg",
};
const sizes: Record<Size, string> = { sm: "h-9 px-3.5 text-sm", md: "h-11 px-5 text-sm" };

type Common = { variant?: Variant; size?: Size; className?: string; children: ReactNode };

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: Common & Omit<ComponentProps<typeof Link>, "className" | "children">) {
  return (
    <Link className={cn(base, variants[variant], sizes[size], className)} {...rest}>
      {children}
    </Link>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  type = "button",
  ...rest
}: Common & Omit<ComponentProps<"button">, "className" | "children">) {
  return (
    <button type={type} className={cn(base, variants[variant], sizes[size], className)} {...rest}>
      {children}
    </button>
  );
}
