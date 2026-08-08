import { authorizeStudySession } from "@/lib/study/recorder.js";
import { noStoreJson, readStudyJson, studyErrorResponse } from "@/lib/study/http.js";
import { StudyError } from "@/lib/study/validation.js";
import {
  createStudyResponse,
  serializeParticipantStudyResponse,
} from "@/lib/study/response-engine.js";
import { callStudyDashScope } from "@/lib/study/dashscope.js";

export const runtime = "nodejs";
// Two identical bounded attempts are allowed for each of the core and hidden
// attribution stages. Local study runs must not be cut off by a 60-second host
// limit while those bounded retries are in progress.
export const maxDuration = 120;

export async function POST(request) {
  try {
    const payload = await readStudyJson(request, 256 * 1024);
    if (Object.hasOwn(payload ?? {}, "condition")) {
      throw new StudyError(
        "CLIENT_CONDITION_FORBIDDEN",
        "The experimental condition is controlled by the prepared study session.",
        400,
      );
    }
    const session = await authorizeStudySession({
      studyId: payload?.studyId,
      sessionToken: payload?.sessionToken,
    }, { requireActive: true });

    const response = await createStudyResponse({
      condition: session.condition,
      initial: payload?.initial === true,
      question: payload?.question,
      history: payload?.history,
    }, {
      callModel: (messages, options) => callStudyDashScope(messages, {
        ...options,
        signal: request.signal,
      }),
    });
    return noStoreJson({ response: serializeParticipantStudyResponse(response) });
  } catch (error) {
    return studyErrorResponse(error);
  }
}
