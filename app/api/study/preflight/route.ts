import { runStudyPreflight } from "@/lib/study/preflight.js";
import { noStoreJson, studyErrorResponse, verifyStudyRequest } from "@/lib/study/http.js";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    verifyStudyRequest(request);
    return noStoreJson(await runStudyPreflight());
  } catch (error) {
    return studyErrorResponse(error);
  }
}
