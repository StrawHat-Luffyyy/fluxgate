export default function Skeleton({
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`animate-shimmer rounded-lg bg-gradient-to-r from-gray-800 via-gray-700 to-gray-800 bg-[length:200%_100%] ${className}`}
      {...props}
    />
  );
}
