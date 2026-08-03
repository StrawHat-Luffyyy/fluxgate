import type { LucideIcon } from "lucide-react";
import Skeleton from "./Skeleton";

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  iconColorClass: string; // e.g. "bg-blue-500/20 text-blue-400"
}

export default function StatCard({
  icon: Icon,
  label,
  value,
  iconColorClass,
}: StatCardProps) {
  return (
    <div className="bg-[#1a1d24] p-6 rounded-xl border border-gray-800 flex items-center gap-4 transition-all hover:border-gray-600">
      <div className={`p-3 rounded-lg ${iconColorClass}`}>
        <Icon size={24} />
      </div>
      <div>
        <p className="text-gray-400 text-sm">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
      </div>
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="bg-[#1a1d24] p-6 rounded-xl border border-gray-800 flex items-center gap-4">
      <Skeleton className="h-12 w-12 rounded-lg" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-16" />
      </div>
    </div>
  );
}
