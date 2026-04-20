// src/app/layout.js
import { AuthProvider } from "@/components/providers/AuthProvider";
import "./globals.css";

export const metadata = {
  title: "CorpHQ — Employee Management Portal",
  description: "Attendance tracking, leave management, HR analytics",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
