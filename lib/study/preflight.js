import { access, mkdir, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { configuredStudyRecordRoot } from "./constants.js";
import { validateFrozenInitialAnswerPack } from "./frozen-initial-answer.js";
import {
  RELATIONAL_MODEL_PDF_SHA256,
  RELATIONAL_MODEL_PUBLIC_PATH,
} from "./relational-model-material.js";
import { StudyError } from "./validation.js";

const MATERIAL_FILE = path.join(
  process.cwd(),
  "public",
  RELATIONAL_MODEL_PUBLIC_PATH.replace(/^\/+/, ""),
);

async function materialCheck() {
  try {
    const data = await readFile(MATERIAL_FILE);
    const hash = createHash("sha256").update(data).digest("hex");
    return {
      ok: hash === RELATIONAL_MODEL_PDF_SHA256,
      hash,
      expectedHash: RELATIONAL_MODEL_PDF_SHA256,
      bytes: data.byteLength,
    };
  } catch {
    return {
      ok: false,
      hash: null,
      expectedHash: RELATIONAL_MODEL_PDF_SHA256,
      bytes: 0,
    };
  }
}

async function storageCheck(options = {}) {
  const root = path.resolve(options.root || configuredStudyRecordRoot());
  try {
    await mkdir(root, { recursive: true, mode: 0o700 });
    await access(root, fsConstants.R_OK | fsConstants.W_OK);
    return { ok: true, root };
  } catch {
    return { ok: false, root };
  }
}

export async function runStudyPreflight(options = {}) {
  const [material, storage] = await Promise.all([
    materialCheck(),
    storageCheck(options),
  ]);
  const frozenPack = validateFrozenInitialAnswerPack();
  const modelConfigured = Boolean(process.env.DASHSCOPE_API_KEY?.trim());
  const checks = {
    material: {
      ok: material.ok,
      label: "Fixed DBI lecture verified",
      detail: material.ok ? "27-page frozen study material" : "Material file is missing or has changed",
    },
    frozenAnswers: {
      ok: frozenPack.valid,
      label: "Frozen opening explanations verified",
      detail: frozenPack.valid ? "A=C and B=D core equality confirmed" : frozenPack.errors.join("; "),
    },
    storage: {
      ok: storage.ok,
      label: "Local research record folder writable",
      detail: storage.ok ? storage.root : "The record folder cannot be written",
    },
    model: {
      ok: modelConfigured,
      label: "Qwen Plus configured",
      detail: modelConfigured ? "Ready for participant follow-up questions" : "DASHSCOPE_API_KEY is not configured",
    },
  };
  return {
    ready: Object.values(checks).every((check) => check.ok),
    checks,
    materialHash: material.hash,
  };
}

export async function assertStudyPreflight(options = {}) {
  const result = await runStudyPreflight(options);
  if (!result.ready) {
    const failed = Object.values(result.checks).filter((check) => !check.ok).map((check) => check.label);
    throw new StudyError(
      "STUDY_PREFLIGHT_FAILED",
      `The study system is not ready: ${failed.join(", ")}.`,
      503,
      { failed },
    );
  }
  return result;
}

export const studyPreflightInternals = Object.freeze({ MATERIAL_FILE });
