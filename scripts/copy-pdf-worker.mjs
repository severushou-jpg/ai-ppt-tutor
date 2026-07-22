import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
await mkdir(path.join(root, "public"), { recursive: true });
await copyFile(
  path.join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs"),
  path.join(root, "public", "pdf.worker.min.mjs"),
);
