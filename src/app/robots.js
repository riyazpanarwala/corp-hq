import { SITE_URL } from "@/lib/site";

export default function robots() {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/login", "/forgot-password", "/reset-password"],
        disallow: ["/admin/", "/employee/", "/api/", "/_next/"],
      },
    ],
    host: SITE_URL,
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
