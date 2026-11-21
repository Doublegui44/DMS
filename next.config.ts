import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // e2e runs a second dev server alongside the normal one.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  typedRoutes: false,
  serverExternalPackages: ["@prisma/client", "bcryptjs", "@react-pdf/renderer"],
};

export default withNextIntl(nextConfig);
