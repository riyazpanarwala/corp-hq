const siteUrl = "https://corp-hq.panarwala.in";

export default function sitemap() {
  return [
    {
      url: `${siteUrl}/login`,
      changeFrequency: "yearly",
      priority: 1,
    },
  ];
}
