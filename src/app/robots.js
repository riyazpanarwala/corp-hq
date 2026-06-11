import { SITE_URL } from "@/lib/site";

export default function robots() {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
    host: SITE_URL,
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
