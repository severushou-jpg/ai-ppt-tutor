import { createStudySession } from "@/lib/study/recorder.js";
import { readStudyJson, studyErrorResponse } from "@/lib/study/http.js";
import { assertStudyPreflight } from "@/lib/study/preflight.js";
import {
  STUDY_MATERIAL_VERSION,
  STUDY_MODEL_VERSION,
  STUDY_PROMPT_VERSION,
} from "@/lib/study/canonical.js";
import {
  FROZEN_ANSWER_PACK_VERSION,
  FROZEN_CITATION_MAP_VERSION,
} from "@/lib/study/frozen-initial-answer.js";
import { RELATIONAL_MODEL_PDF_SHA256 } from "@/lib/study/relational-model-material.js";
import { NextResponse } from "next/server";
import { EXPERIMENT_ADMIN_COOKIE, experimentAdminCapability } from "@/lib/experiment-admin.js";
import { StudyError } from "@/lib/study/validation.js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const admin = experimentAdminCapability(request);
    if (!admin.authorized && !admin.configured) {
      throw new StudyError("EXPERIMENT_NOT_CONFIGURED", "The researcher control key is not configured.", 503);
    }
    if (!admin.authorized) {
      throw new StudyError("EXPERIMENT_ADMIN_REQUIRED", "Researcher authorization is required.", 401);
    }
    const payload = await readStudyJson(request, 16 * 1024);
    await assertStudyPreflight();
    const result = await createStudySession({
      ...payload,
      metadata: {
        ...(payload?.metadata ?? {}),
        materialHash: RELATIONAL_MODEL_PDF_SHA256,
        materialVersion: STUDY_MATERIAL_VERSION,
        modelVersion: STUDY_MODEL_VERSION,
        promptVersion: STUDY_PROMPT_VERSION,
        answerPackVersion: FROZEN_ANSWER_PACK_VERSION,
        citationMapVersion: FROZEN_CITATION_MAP_VERSION,
        buildCommit:
          process.env.STUDY_BUILD_COMMIT ||
          process.env.VERCEL_GIT_COMMIT_SHA ||
          "local-working-tree",
      },
    });
    const response = NextResponse.json({ session: result.session, sessionToken: result.sessionToken }, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
    // A remote participant never inherits the setup privilege. Localhost
    // sessions use the request-scoped loopback capability instead of a cookie.
    response.cookies.delete(EXPERIMENT_ADMIN_COOKIE);
    return response;
  } catch (error) {
    return studyErrorResponse(error);
  }
}
