// src/app/page.js
import { redirect } from "next/navigation";
export default function RootPage() {
  redirect("/login");
}
