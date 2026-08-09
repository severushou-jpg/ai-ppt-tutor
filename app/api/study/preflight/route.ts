import { runStudyPreflight } from "@/lib/study/preflight.js";
import { noStoreJson, studyErrorResponse, verifyStudyRequest } from "@/lib/study/http.js";
import { experimentAdminCapability } from "@/lib/experiment-admin.js";
import { StudyError } from "@/lib/study/validation.js";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    verifyStudyRequest(request);
    const admin = experimentAdminCapability(request);
    if (!admin.authorized && !admin.configured) {
      throw new StudyError("EXPERIMENT_NOT_CONFIGURED", "The researcher control key is not configured.", 503);
    }
    if (!admin.authorized) {
      throw new StudyError("EXPERIMENT_ADMIN_REQUIRED", "Researcher authorization is required.", 401);
    }
    return noStoreJson(await runStudyPreflight());
  } catch (error) {
    return studyErrorResponse(error);
  }
}
