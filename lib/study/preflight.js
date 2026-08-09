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
import {
  STUDY_PROTOCOL_ASSETS,
  STUDY_PROTOCOL_MANIFEST_PUBLIC_PATH,
  STUDY_PROTOCOL_VERSION,
  validateStudyProtocolConfiguration,
} from "./protocol.js";
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

async function protocolAssetsCheck(options = {}) {
  const publicRoot = path.resolve(options.publicRoot || path.join(process.cwd(), "public"));
  const manifestFile = path.join(
    publicRoot,
    STUDY_PROTOCOL_MANIFEST_PUBLIC_PATH.replace(/^\/+/, ""),
  );
  let manifest;
  const errors = [];
  try {
    manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  } catch {
    errors.push("protocol manifest is missing or invalid");
    manifest = null;
  }
  if (manifest?.protocolVersion !== STUDY_PROTOCOL_VERSION) {
    errors.push("protocol manifest version does not match the application");
  }

  const assets = await Promise.all(STUDY_PROTOCOL_ASSETS.map(async (asset) => {
    const manifestEntry = asset.kind === "informationSheet"
      ? manifest?.informationSheet
      : asset.kind === "informationSheetPreview"
        ? manifest?.informationSheet?.previews?.find((preview) => preview?.page === asset.page)
        : manifest?.forms?.[path.posix.basename(asset.publicPath)];
    const expectedHash = asset.expectedSha256;
    const metadataMatches = asset.kind === "informationSheet"
      ? manifestEntry?.version === asset.version
      : asset.kind === "informationSheetPreview"
        ? manifestEntry?.page === asset.page
          && manifestEntry?.width === asset.width
          && manifestEntry?.height === asset.height
        : manifestEntry?.url === asset.url;
    const manifestEntryValid = Boolean(
      manifestEntry
      && manifestEntry.path === asset.publicPath
      && /^[a-f0-9]{64}$/i.test(expectedHash || "")
      && manifestEntry.sha256 === expectedHash
      && metadataMatches,
    );
    if (!manifestEntryValid) errors.push(`${asset.id} manifest entry does not match the frozen configuration`);
    const file = path.join(publicRoot, asset.publicPath.replace(/^\/+/, ""));
    try {
      const data = await readFile(file);
      const hash = createHash("sha256").update(data).digest("hex");
      return {
        id: asset.id,
        ok: data.byteLength > 0 && manifestEntryValid && hash.toLowerCase() === expectedHash.toLowerCase(),
        bytes: data.byteLength,
        hash,
        expectedHash: expectedHash || null,
      };
    } catch {
      return {
        id: asset.id,
        ok: false,
        bytes: 0,
        hash: null,
        expectedHash: expectedHash || null,
      };
    }
  }));
  return { ok: errors.length === 0 && assets.every((asset) => asset.ok), assets, errors };
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
  const [material, protocolAssets, storage] = await Promise.all([
    materialCheck(),
    protocolAssetsCheck({ publicRoot: options.publicRoot }),
    storageCheck(options),
  ]);
  const frozenPack = validateFrozenInitialAnswerPack();
  const protocolConfiguration = validateStudyProtocolConfiguration();
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
    protocolConfiguration: {
      ok: protocolConfiguration.valid,
      label: "Participant procedure configuration verified",
      detail: protocolConfiguration.valid
        ? "Approved Microsoft Forms URLs and local study paths"
        : protocolConfiguration.errors.join("; "),
    },
    protocolAssets: {
      ok: protocolAssets.ok,
      label: "Frozen participant procedure assets verified",
      detail: protocolAssets.ok
        ? "Information Sheet PDF, two page previews and three QR assets available"
        : [
          `Missing or changed: ${protocolAssets.assets.filter((asset) => !asset.ok).map((asset) => asset.id).join(", ")}`,
          ...protocolAssets.errors,
        ].filter(Boolean).join("; "),
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
    protocolAssets: protocolAssets.assets,
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

export const studyPreflightInternals = Object.freeze({ MATERIAL_FILE, protocolAssetsCheck });
