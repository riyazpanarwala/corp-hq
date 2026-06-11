// src/app/layout.js
// Google Fonts is loaded via <link> tags here instead of @import in globals.css.
// Tailwind v4's PostCSS plugin expands @import "tailwindcss" into thousands of CSS
// rules at transform time, which causes any @import url(...) that follows it to
// violate the CSS spec. Using <link> in the HTML head sidesteps this entirely.
import { AuthProvider } from "@/components/providers/AuthProvider";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: "CorpHQ",
  title: {
    default: "CorpHQ | Employee Management Portal",
    template: "%s | CorpHQ",
  },
  description:
    "Secure employee portal for attendance tracking, leave management, and HR analytics.",
  alternates: {
    canonical: "/login",
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: "/icon.svg",
  },
  openGraph: {
    type: "website",
    url: "/login",
    siteName: "CorpHQ",
    title: "CorpHQ | Employee Management Portal",
    description:
      "Secure employee portal for attendance tracking, leave management, and HR analytics.",
  },
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
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
