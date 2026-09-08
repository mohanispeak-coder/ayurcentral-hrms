/**
 * Client-callable Ask HR API.
 * Browser talks only to HRMS (google.script.run / callServer). Knowledge Hub is server-side.
 *
 * callServer unwraps hrmsRun_ so the UI receives the inner chatbot payload:
 *   { ok: true, version, requestId, answer, keyPoints, references, notFound, executionMs }
 *   { ok: false, version, requestId, error: { code, message } }
 *
 * Single on-demand RPC. Knowledge retrieval runs on Ayurveda-AI (Drive + Gemini).
 * Not called at startup — only when the employee sends a question.
 */

function apiAskHr(question, sessionToken) {
  return hrmsRun_(function () {
    return AskHrService.ask(question);
  }, sessionToken);
}
