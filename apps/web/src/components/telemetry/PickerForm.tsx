"use client";

import type { FormEvent, ReactNode } from "react";

/**
 * The lab's GET form, applied as soon as a choice changes (the Compare button stays for keyboard users and without JavaScript).
 * A new session resets both drivers to that session's fastest two: the previous car numbers may have no lap in it.
 */
export function PickerForm({ className, children }: { className?: string; children: ReactNode }) {
  const onChange = (e: FormEvent<HTMLFormElement>) => {
    const form = e.currentTarget;
    const field = e.target as HTMLSelectElement;
    if (field.name === "session") for (const name of ["a", "b"]) (form.elements.namedItem(name) as HTMLSelectElement | null)?.setAttribute("disabled", "");
    form.requestSubmit();
  };
  return (
    <form method="get" className={className} onChange={onChange}>
      {children}
    </form>
  );
}
