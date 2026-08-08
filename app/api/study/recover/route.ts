import { recoverStudySession } from "@/lib/study/recorder.js";
import { noStoreJson, studyErrorResponse, verifyStudyRequest } from "@/lib/study/http.js";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    verifyStudyRequest(request);
    const url = new URL(request.url);
    const result = await recoverStudySession({
      studyId: url.searchParams.get("studyId"),
      sessionToken: request.headers.get("x-study-session-token"),
    });
    return noStoreJson({ session: result.session });
  } catch (error) {
    return studyErrorResponse(error);
  }
}
