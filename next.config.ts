import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse (pdfjs-dist) loads its worker by file path at runtime — keep it
  // out of the server bundle so the path resolves in node_modules.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  outputFileTracingIncludes: {
    // The researcher directory is read from disk at runtime, and pdfjs resolves
    // its worker as a real file, so both must be traced into serverless
    // deployments (Vercel) or resume upload fails with a missing-module error.
    "/**": ["./data/**", "./node_modules/pdfjs-dist/legacy/build/**"],
  },
};

export default nextConfig;
