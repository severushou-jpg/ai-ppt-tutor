import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  serverExternalPackages: ["officeparser", "pdfjs-dist"],
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
