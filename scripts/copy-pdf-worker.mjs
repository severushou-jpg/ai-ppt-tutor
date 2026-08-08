import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const publicRoot = path.join(root, "public");
const tesseractRoot = path.join(publicRoot, "tesseract");
const tesseractCoreRoot = path.join(tesseractRoot, "core");
const tessdataRoot = path.join(publicRoot, "tessdata");

await Promise.all([
  mkdir(publicRoot, { recursive: true }),
  mkdir(tesseractCoreRoot, { recursive: true }),
  mkdir(tessdataRoot, { recursive: true }),
]);

const copies = [
  [
    path.join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs"),
    path.join(publicRoot, "pdf.worker.min.mjs"),
  ],
  [
    path.join(root, "node_modules", "tesseract.js", "dist", "worker.min.js"),
    path.join(tesseractRoot, "worker.min.js"),
  ],
  ...[
    "tesseract-core-lstm.wasm.js",
    "tesseract-core-simd-lstm.wasm.js",
    "tesseract-core-relaxedsimd-lstm.wasm.js",
  ].map((fileName) => [
    path.join(root, "node_modules", "tesseract.js-core", fileName),
    path.join(tesseractCoreRoot, fileName),
  ]),
  [
    path.join(root, "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int", "eng.traineddata.gz"),
    path.join(tessdataRoot, "eng.traineddata.gz"),
  ],
  [
    path.join(root, "node_modules", "@tesseract.js-data", "chi_sim", "4.0.0_best_int", "chi_sim.traineddata.gz"),
    path.join(tessdataRoot, "chi_sim.traineddata.gz"),
  ],
];

await Promise.all(copies.map(([source, destination]) => copyFile(source, destination)));
