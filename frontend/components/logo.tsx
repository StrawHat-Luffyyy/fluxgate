/** Two gate posts with traffic passing between them. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <svg aria-hidden viewBox="0 0 32 32" className="size-5">
        <path
          d="M10 5v22M22 5v22"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M2 21c5 0 6-10 14-10s9 10 14 10"
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      FluxGate
    </span>
  );
}
