import { verifySameOriginRequest } from "../request-security.js";
import { StudyError } from "./validation.js";

export function noStoreJson(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function studyErrorResponse(error) {
  if (error instanceof StudyError) {
    return noStoreJson({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    }, error.status);
  }
  // Never echo an arbitrary error message here: it could contain user input or
  // a provider credential. Detailed diagnostics belong in the redacted study
  // error event stream, not the process console.
  console.error("Study API failure", { name: error instanceof Error ? error.name : "UnknownError" });
  return noStoreJson({
    error: { code: "STUDY_STORAGE_FAILED", message: "The local study record could not be updated." },
  }, 500);
}

export function verifyStudyRequest(request) {
  const origin = verifySameOriginRequest(request);
  if (!origin.allowed) {
    throw new StudyError(origin.code, "Cross-site study requests are not allowed.", origin.status);
  }
}

export async function readStudyJson(request, maximumBytes = 256 * 1024) {
  verifyStudyRequest(request);
  const contentType = request.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.startsWith("application/json")) {
    throw new StudyError("UNSUPPORTED_MEDIA_TYPE", "The request must use application/json.", 415);
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new StudyError("REQUEST_TOO_LARGE", "The study request is too large.", 413);
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maximumBytes) {
    throw new StudyError("REQUEST_TOO_LARGE", "The study request is too large.", 413);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new StudyError("INVALID_JSON", "The request body is not valid JSON.");
  }
}
