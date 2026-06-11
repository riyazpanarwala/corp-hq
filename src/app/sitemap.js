import { SITE_URL } from "@/lib/site";

export default function sitemap() {
  return [
    {
      url: `${SITE_URL}/login`,
      changeFrequency: "yearly",
      priority: 1,
    },
  ];
}
