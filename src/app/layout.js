// src/app/layout.js
// Google Fonts is loaded via <link> tags here instead of @import in globals.css.
// Tailwind v4's PostCSS plugin expands @import "tailwindcss" into thousands of CSS
// rules at transform time, which causes any @import url(...) that follows it to
// violate the CSS spec. Using <link> in the HTML head sidesteps this entirely.
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
  applicationName: "Panarwala CorpHQ",
  title: {
    default: "Panarwala CorpHQ | Employee Management Portal",
    template: "%s | Panarwala CorpHQ",
  },
  description:
    "Panarwala CorpHQ is a secure employee portal for attendance tracking, leave management, and HR analytics.",
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
    siteName: "Panarwala CorpHQ",
    title: "Panarwala CorpHQ | Employee Management Portal",
    description:
      "Panarwala CorpHQ is a secure employee portal for attendance tracking, leave management, and HR analytics.",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Panarwala CorpHQ | Employee Management Portal",
    description:
      "Panarwala CorpHQ is a secure employee portal for attendance tracking, leave management, and HR analytics.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
};

export default function RootLayout({ children }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: "Panarwala",
        url: "https://panarwala.in",
        logo: `${SITE_URL}/icon.svg`,
        sameAs: ["https://corp-hq.panarwala.in"],
      },
      {
        "@type": "WebApplication",
        "@id": `${SITE_URL}/#webapp`,
        url: SITE_URL,
        name: "Panarwala CorpHQ",
        applicationCategory: "BusinessApplication",
        operatingSystem: "All",
        author: {
          "@id": `${SITE_URL}/#organization`,
        },
        description:
          "Panarwala CorpHQ is a secure employee portal for attendance tracking, leave management, and HR analytics.",
      },
    ],
  };

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Syne:wght@600;700;800&display=swap"
          rel="stylesheet"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
