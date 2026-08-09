import { advanceStudyProcedure } from "@/lib/study/recorder.js";
import { noStoreJson, readStudyJson, studyErrorResponse } from "@/lib/study/http.js";
import {
  configuredExperimentAdminKey,
  isLoopbackExperimentRequest,
  verifyExperimentAdminKey,
} from "@/lib/experiment-admin.js";
import { StudyError } from "@/lib/study/validation.js";
import { checkRequestRateLimit } from "@/lib/request-security.js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await readStudyJson(request, 8 * 1024);
    const action = typeof payload?.action === "string" ? payload.action.trim().toLowerCase() : "";
    const localBypass = isLoopbackExperimentRequest(request);
    if (action === "confirm_written_consent" && !localBypass) {
      const rateLimit = checkRequestRateLimit(request, {
        scope: "written-consent-confirmation",
        limit: 8,
        windowMs: 15 * 60 * 1_000,
      });
      if (!rateLimit.allowed) {
        throw new StudyError("RATE_LIMITED", "Too many researcher-key attempts. Please wait before trying again.", 429);
      }
      const secret = configuredExperimentAdminKey();
      if (!secret) {
        throw new StudyError("EXPERIMENT_NOT_CONFIGURED", "The researcher control key is not configured.", 503);
      }
      if (!verifyExperimentAdminKey(payload?.researcherKey, secret)) {
        throw new StudyError("RESEARCHER_CONFIRMATION_REQUIRED", "A valid researcher key is required to confirm written consent.", 401);
      }
    } else if (payload && Object.hasOwn(payload, "researcherKey")) {
      throw new StudyError("RESEARCHER_KEY_NOT_ALLOWED", "A researcher key is accepted only for written-consent confirmation.");
    }
    const result = await advanceStudyProcedure({
      studyId: payload?.studyId,
      sessionToken: payload?.sessionToken,
      action: payload?.action,
    });
    return noStoreJson({
      session: result.session,
      action: result.action,
      idempotent: result.idempotent,
    });
  } catch (error) {
    return studyErrorResponse(error);
  }
}
