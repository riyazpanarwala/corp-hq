/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // serverExternalPackages was introduced in Next.js 15 (moved from
  // experimental.serverComponentsExternalPackages) and remains valid in Next 16.
  serverExternalPackages: ["bcryptjs", "@prisma/client"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options",       value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy",        value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
