import type { ReactNode } from "react";

/** Wide tables scroll inside themselves, and the scroll area is keyboard-reachable. */
export function TableWrap({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} tabIndex={0} className={`overflow-x-auto ${className}`}>
      <table className="fg-table">{children}</table>
    </div>
  );
}
