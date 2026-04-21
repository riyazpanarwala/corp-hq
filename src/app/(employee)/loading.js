// src/app/(employee)/loading.js
import { Skeleton } from "@/components/ui";

export default function EmployeeLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, padding: "0 0 32px" }}>
      <Skeleton height={32} width={240} />
      <Skeleton height={200} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 14 }}>
        {[...Array(4)].map((_,i) => <Skeleton key={i} height={110} />)}
      </div>
      <Skeleton height={280} />
    </div>
  );
}
