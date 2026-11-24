import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // e2e runs a second dev server alongside the normal one.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  typedRoutes: false,
  // Desktop app (Phase 12): a self-contained server.js. Off for dev, CI and e2e.
  ...(process.env.NEXT_STANDALONE === "1"
    ? {
        output: "standalone" as const,
        // pdfkit loads its standard fonts by name at run time, so tracing cannot see them.
        outputFileTracingIncludes: { "/api/pdf/**": ["./node_modules/pdfkit/js/standard-fonts/**"] },
      }
    : {}),
  serverExternalPackages: ["@prisma/client", "bcryptjs", "@react-pdf/renderer"],
};

export default withNextIntl(nextConfig);
