import { startStudySession } from "@/lib/study/recorder.js";
import { noStoreJson, readStudyJson, studyErrorResponse } from "@/lib/study/http.js";
import { assertStudyPreflight } from "@/lib/study/preflight.js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await readStudyJson(request, 8 * 1024);
    await assertStudyPreflight();
    const result = await startStudySession(payload);
    return noStoreJson({ session: result.session });
  } catch (error) {
    return studyErrorResponse(error);
  }
}
