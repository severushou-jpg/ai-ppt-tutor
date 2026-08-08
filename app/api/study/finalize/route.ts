import { finalizeStudySession } from "@/lib/study/recorder.js";
import { noStoreJson, readStudyJson, studyErrorResponse } from "@/lib/study/http.js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await readStudyJson(request, 256 * 1024);
    const result = await finalizeStudySession(payload);
    return noStoreJson(result);
  } catch (error) {
    return studyErrorResponse(error);
  }
}
