// src/app/(admin)/loading.js
import { Skeleton } from "@/components/ui";

export default function AdminLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, padding: "0 0 32px" }}>
      <Skeleton height={32} width={260} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 14 }}>
        {[...Array(5)].map((_,i) => <Skeleton key={i} height={110} />)}
      </div>
      <Skeleton height={320} />
    </div>
  );
}
