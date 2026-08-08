"use client";

import ReactMarkdown from "react-markdown";
import { BookOpen, Sparkles } from "lucide-react";
import type { EvidenceAnchor, StudyChatMessage } from "@/app/study/types";

const HYPOTHETICAL_EXAMPLE_LABEL = "Hypothetical example - not taken directly from the lecture.";
const LECTURE_EXAMPLE_LABEL = "Lecture example - taken directly from the lecture.";

export function StudyAnswerCard({
  message,
  initial = false,
  onCitationClick,
}: {
  message: StudyChatMessage;
  initial?: boolean;
  onCitationClick: (anchor: EvidenceAnchor, sourceNumber: number, messageId: string) => void;
}) {
  const answer = message.answer;
  const citations = message.citations ?? [];
  const sourceNumbers = new Map<string, number>();
  let nextSourceNumber = 1;
  for (const citation of citations) {
    for (const anchor of citation.anchors) {
      if (!sourceNumbers.has(anchor.anchorId)) {
        sourceNumbers.set(anchor.anchorId, nextSourceNumber);
        nextSourceNumber += 1;
      }
    }
  }

  function markersForClaim(claimId: string) {
    const anchors = citations.find((citation) => citation.claimId === claimId)?.anchors ?? [];
    return anchors.map((anchor) => {
      const sourceNumber = sourceNumbers.get(anchor.anchorId) ?? 1;
      return (
        <button
          key={anchor.anchorId}
          type="button"
          onClick={() => onCitationClick(anchor, sourceNumber, message.id)}
          className="ml-1 inline-flex min-w-6 translate-y-[-1px] items-center justify-center rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[11px] font-bold leading-4 text-blue-700 transition hover:border-blue-400 hover:bg-blue-100 focus-visible:outline-none"
          aria-label={`Open lecture source ${sourceNumber}`}
          title={`Open lecture source ${sourceNumber}`}
        >
          {sourceNumber}
        </button>
      );
    });
  }

  function renderClaim(claim: { id: string; text: string }) {
    const provenance = claim.text.startsWith(HYPOTHETICAL_EXAMPLE_LABEL)
      ? { label: HYPOTHETICAL_EXAMPLE_LABEL, tone: "hypothetical" as const }
      : claim.text.startsWith(LECTURE_EXAMPLE_LABEL)
        ? { label: LECTURE_EXAMPLE_LABEL, tone: "lecture" as const }
        : null;
    if (!provenance) {
      return (
        <p key={claim.id} className="text-sm leading-7 text-slate-700">
          {claim.text}
          {markersForClaim(claim.id)}
        </p>
      );
    }
    const detail = claim.text.slice(provenance.label.length).trim();
    const palette = provenance.tone === "hypothetical"
      ? "border-amber-200 bg-amber-50/80 text-amber-950"
      : "border-blue-200 bg-blue-50/80 text-blue-950";
    const badge = provenance.tone === "hypothetical"
      ? "bg-amber-100 text-amber-800"
      : "bg-blue-100 text-blue-800";
    return (
      <div key={claim.id} className={`rounded-xl border px-3.5 py-3 text-sm leading-6 ${palette}`}>
        <span className={`mr-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${badge}`}>
          {provenance.tone === "hypothetical" ? "Illustrative example" : "Lecture example"}
        </span>
        <span className="font-medium">{provenance.label}</span>
        {detail ? <span className="ml-1">{detail}</span> : null}
        {markersForClaim(claim.id)}
      </div>
    );
  }

  return (
    <article className={`overflow-hidden rounded-2xl border bg-white shadow-[0_12px_35px_rgba(15,23,42,0.06)] ${initial ? "border-blue-100" : "border-slate-200"}`}>
      <header className={`flex items-center gap-3 border-b px-5 py-4 ${initial ? "border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50/60" : "border-slate-100"}`}>
        <div className={`grid h-9 w-9 place-items-center rounded-xl ${initial ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}>
          {initial ? <BookOpen className="h-4.5 w-4.5" aria-hidden="true" /> : <Sparkles className="h-4.5 w-4.5" aria-hidden="true" />}
        </div>
        <div>
          <p className="text-sm font-bold text-slate-900">{initial ? "Relational Model lecture guide" : "AI-PPT Tutor"}</p>
          <p className="mt-0.5 text-xs text-slate-500">{initial ? "A structured introduction to the study material" : "Response to your question"}</p>
        </div>
      </header>

      <div className="px-5 py-5 sm:px-6 sm:py-6">
        {answer?.summary ? (
          <p className="mb-5 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-700">
            {answer.summary}
            {markersForClaim("summary")}
          </p>
        ) : null}

        {answer?.sections?.length ? (
          <div className="space-y-6">
            {answer.sections.map((section) => (
              <section key={section.id}>
                <h2 className="mb-2.5 text-base font-bold tracking-tight text-slate-900">{section.heading}</h2>
                <div className="space-y-2.5">
                  {section.claims.map(renderClaim)}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="study-markdown text-sm leading-7 text-slate-700">
            <ReactMarkdown>{answer?.content || message.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </article>
  );
}
