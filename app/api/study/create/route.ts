import { createStudySession } from "@/lib/study/recorder.js";
import { noStoreJson, readStudyJson, studyErrorResponse } from "@/lib/study/http.js";
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

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
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
    return noStoreJson({ session: result.session, sessionToken: result.sessionToken }, 201);
  } catch (error) {
    return studyErrorResponse(error);
  }
}
