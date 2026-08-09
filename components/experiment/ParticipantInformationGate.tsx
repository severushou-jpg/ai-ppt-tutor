"use client";

import Image from "next/image";
import { useState } from "react";
import { BookOpenCheck, CheckCircle2, ExternalLink, FileText, LoaderCircle, ShieldCheck } from "lucide-react";
import { STUDY_INFORMATION_SHEET } from "@/lib/study/protocol-config.js";

interface ParticipantInformationGateProps {
  studyId: string;
  stage: "information_sheet" | "written_consent";
  pending: boolean;
  error: string | null;
  requireResearcherKey: boolean;
  onAcknowledge: () => void;
  onConfirmWrittenConsent: (researcherKey?: string) => void;
}

export function ParticipantInformationGate({
  studyId,
  stage,
  pending,
  error,
  requireResearcherKey,
  onAcknowledge,
  onConfirmWrittenConsent,
}: ParticipantInformationGateProps) {
  const [participantConfirmed, setParticipantConfirmed] = useState(false);
  const [researcherConfirmed, setResearcherConfirmed] = useState(false);
  const [researcherKey, setResearcherKey] = useState("");

  if (stage === "written_consent") {
    return (
      <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#f4f7fb] p-5">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_5%,rgba(37,99,235,0.14),transparent_36%),radial-gradient(circle_at_85%_12%,rgba(99,102,241,0.13),transparent_34%)]" />
        <section className="relative w-full max-w-2xl overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.14)]">
          <div className="border-b border-slate-100 bg-gradient-to-br from-slate-950 via-blue-950 to-indigo-900 px-7 py-8 text-white sm:px-10">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/12 ring-1 ring-white/20">
              <ShieldCheck className="h-7 w-7" aria-hidden="true" />
            </div>
            <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-blue-200">Researcher checkpoint</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Confirm written consent</h1>
            <p className="mt-3 text-sm leading-6 text-blue-100/85">Study ID: <span className="font-mono font-bold text-white">{studyId}</span></p>
          </div>
          <div className="px-7 py-8 sm:px-10">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
              <p className="font-bold">This confirmation must be completed by the researcher.</p>
              <p className="mt-1">The participant&apos;s Information Sheet acknowledgement is not a substitute for signed written consent.</p>
            </div>
            <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 p-5 transition hover:bg-slate-50">
              <input
                type="checkbox"
                checked={researcherConfirmed}
                onChange={(event) => setResearcherConfirmed(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm leading-6 text-slate-700">
                I, the researcher, confirm that the signed written consent form for <strong>{studyId}</strong> has been received and checked before the participant proceeds.
              </span>
            </label>
            {requireResearcherKey ? (
              <label className="mt-4 block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">Researcher control key</span>
                <input
                  type="password"
                  value={researcherKey}
                  onChange={(event) => setResearcherKey(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 transition focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-50"
                  placeholder="Enter the researcher key"
                />
                <span className="mt-2 block text-xs leading-5 text-slate-500">The key is checked by the study service and is never stored in the participant record.</span>
              </label>
            ) : (
              <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-xs leading-5 text-blue-800">
                Local supervised study mode: no control key is required. The researcher must still personally check the signed consent form and complete this confirmation.
              </div>
            )}
            {error ? <p role="alert" className="mt-4 text-sm text-red-700">{error}</p> : null}
            <button
              type="button"
              onClick={() => {
                const suppliedKey = requireResearcherKey ? researcherKey : undefined;
                setResearcherKey("");
                onConfirmWrittenConsent(suppliedKey);
              }}
              disabled={!researcherConfirmed || (requireResearcherKey && !researcherKey.trim()) || pending}
              className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 text-sm font-bold text-white shadow-lg shadow-blue-100 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
            >
              {pending ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
              {pending ? "Saving confirmation…" : "Confirm Signed Consent and Continue"}
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f4f7fb] p-3 sm:p-6">
      <section className="mx-auto max-w-5xl overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_25px_80px_rgba(15,23,42,0.12)] sm:rounded-[2rem]">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-gradient-to-r from-slate-950 via-blue-950 to-indigo-900 px-6 py-5 text-white sm:px-8">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-white/12 ring-1 ring-white/20">
              <BookOpenCheck className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-200">Before the study</p>
              <h1 className="text-xl font-bold sm:text-2xl">Participant Information Sheet</h1>
            </div>
          </div>
          <span className="rounded-lg bg-white/10 px-3 py-2 font-mono text-sm font-bold ring-1 ring-white/15">{studyId}</span>
        </header>

        <div className="p-4 sm:p-7">
          <div className="mx-auto max-w-4xl">
            <div className="flex flex-col gap-4 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-blue-600 shadow-sm ring-1 ring-blue-100">
                  <FileText className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-950 sm:text-lg">Please read both pages</h2>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                    Scroll through the complete Information Sheet below. It explains voluntary participation, withdrawal, confidentiality and researcher contacts.
                  </p>
                </div>
              </div>
              <a
                href={STUDY_INFORMATION_SHEET.publicPath}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-3 text-sm font-bold text-blue-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
              >
                Open full-size PDF <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>

            <div
              className="mt-5 h-[62vh] min-h-[440px] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-slate-200/70 p-2 shadow-inner sm:p-4"
              aria-label="Participant Information Sheet, two pages"
              tabIndex={0}
            >
              <div className="mx-auto max-w-[820px] space-y-5">
                {STUDY_INFORMATION_SHEET.previewPages.map((preview, index) => (
                  <figure key={preview.publicPath} className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-md">
                    <figcaption className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-center text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                      Page {preview.page} of {STUDY_INFORMATION_SHEET.previewPages.length}
                    </figcaption>
                    <Image
                      src={preview.publicPath}
                      alt={`Participant Information Sheet page ${preview.page} of ${STUDY_INFORMATION_SHEET.previewPages.length}`}
                      width={preview.width}
                      height={preview.height}
                      priority={index === 0}
                      unoptimized
                      sizes="(max-width: 768px) calc(100vw - 3rem), 820px"
                      className="h-auto w-full bg-white"
                    />
                  </figure>
                ))}
              </div>
            </div>

            <div className="mx-auto mt-5 max-w-3xl rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50 p-4 transition hover:bg-slate-100">
                <input
                  type="checkbox"
                  checked={participantConfirmed}
                  onChange={(event) => setParticipantConfirmed(event.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm leading-6 text-slate-700">
                  I confirm that I have read and understood both pages of the Participant Information Sheet. I understand that this acknowledgement is separate from written consent.
                </span>
              </label>
              {error ? <p role="alert" className="mt-4 text-center text-sm text-red-700">{error}</p> : null}
              <button
                type="button"
                onClick={onAcknowledge}
                disabled={!participantConfirmed || pending}
                className="mx-auto mt-4 flex h-12 w-full max-w-md items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 text-sm font-bold text-white shadow-lg shadow-blue-100 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
              >
                {pending ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
                {pending ? "Saving acknowledgement…" : "I Have Read and Understood"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
