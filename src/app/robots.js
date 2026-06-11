export default function robots() {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
    host: "https://corp-hq.panarwala.in",
  };
}
