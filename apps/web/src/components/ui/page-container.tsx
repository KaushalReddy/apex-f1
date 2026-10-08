import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[88rem] px-4 py-10 sm:px-6 lg:px-8 lg:py-14", className)}>{children}</div>;
}
