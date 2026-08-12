import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse (pdfjs-dist) loads its worker by file path at runtime — keep it
  // out of the server bundle so the path resolves in node_modules.
  serverExternalPackages: ["pdf-parse"],
  // The researcher directory is read from disk at runtime; make sure it is
  // traced into serverless deployments (Vercel).
  outputFileTracingIncludes: {
    "/**": ["./data/**"],
  },
};

export default nextConfig;
