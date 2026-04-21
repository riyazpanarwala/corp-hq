// src/app/(employee)/error.js
"use client";
import { useEffect } from "react";
import { Btn } from "@/components/ui";

export default function EmployeeError({ error, reset }) {
  useEffect(() => {
    console.error("[Employee error]", error);
  }, [error]);

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minHeight: 400, gap: 16, padding: 32,
    }}>
      <div style={{ fontSize: 36 }}>⚠️</div>
      <h2 style={{ fontFamily: "Syne, sans-serif", fontSize: 20, fontWeight: 700, margin: 0 }}>
        Something went wrong
      </h2>
      <p style={{ color: "var(--text2)", fontSize: 14, textAlign: "center", maxWidth: 380, margin: 0 }}>
        {error?.message || "An unexpected error occurred on this page."}
      </p>
      <Btn onClick={reset} variant="secondary">Try again</Btn>
    </div>
  );
}
