import { appendStudyEvent } from "@/lib/study/recorder.js";
import { noStoreJson, readStudyJson, studyErrorResponse } from "@/lib/study/http.js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await readStudyJson(request);
    const result = await appendStudyEvent(payload);
    return noStoreJson(result, 202);
  } catch (error) {
    return studyErrorResponse(error);
  }
}
