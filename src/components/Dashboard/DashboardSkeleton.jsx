import Skeleton from '../Skeleton';

export default function DashboardSkeleton() {
    return (
    <div className="flex-1 p-3 sm:p-6 space-y-4">
        <Skeleton className="h-14 w-40 rounded-2xl" />
        <div className="grid grid-cols-3 gap-3">
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
        </div>
        <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-32 rounded-3xl" />
            <Skeleton className="h-32 rounded-3xl" />
        </div>
        <Skeleton className="h-48 rounded-3xl" />
        <Skeleton className="h-24 rounded-2xl" />
    </div>
    );
}
