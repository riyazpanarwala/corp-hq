export default function manifest() {
  return {
    name: "CorpHQ Employee Management Portal",
    short_name: "CorpHQ",
    description:
      "Secure employee portal for attendance tracking, leave management, and HR analytics.",
    start_url: "/login",
    display: "standalone",
    background_color: "#0b0e14",
    theme_color: "#4f8ef7",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
