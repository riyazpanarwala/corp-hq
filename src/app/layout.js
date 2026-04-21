// src/app/layout.js
// Google Fonts is loaded via <link> tags here instead of @import in globals.css.
// Tailwind v4's PostCSS plugin expands @import "tailwindcss" into thousands of CSS
// rules at transform time, which causes any @import url(...) that follows it to
// violate the CSS spec. Using <link> in the HTML head sidesteps this entirely.
import { AuthProvider } from "@/components/providers/AuthProvider";
import "./globals.css";

export const metadata = {
  title: "CorpHQ — Employee Management Portal",
  description: "Attendance tracking, leave management, HR analytics",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Syne:wght@600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
