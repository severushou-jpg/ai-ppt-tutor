"use client";

import Image from "next/image";
import { useState } from "react";
import { CheckCircle2, Clipboard, ExternalLink, GraduationCap, LoaderCircle, ShieldAlert } from "lucide-react";

interface StudyFormQrStepProps {
  studyId: string;
  formLabel: string;
  title: string;
  description: string;
  imageSrc: string;
  formUrl: string;
  confirmationLabel: string;
  confirmButtonLabel: string;
  pending: boolean;
  error: string | null;
  unaided?: boolean;
  onConfirm: () => void;
}

export function StudyFormQrStep({
  studyId,
  formLabel,
  title,
  description,
  imageSrc,
  formUrl,
  confirmationLabel,
  confirmButtonLabel,
  pending,
  error,
  unaided = false,
  onConfirm,
}: StudyFormQrStepProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyStudyId() {
    try {
      await navigator.clipboard.writeText(studyId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f4f7fb] p-4 sm:p-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_2%,rgba(37,99,235,0.14),transparent_34%),radial-gradient(circle_at_90%_5%,rgba(99,102,241,0.13),transparent_35%)]" />
      <section className="relative mx-auto max-w-5xl overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.14)]">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-5 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-100">
              <GraduationCap className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">AI-PPT Tutor Study</p>
              <h1 className="text-xl font-bold text-slate-950 sm:text-2xl">{formLabel}</h1>
            </div>
          </div>
          <button
            type="button"
            onClick={copyStudyId}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 font-mono text-sm font-bold text-slate-800 transition hover:bg-slate-100"
            aria-label={`Copy Study ID ${studyId}`}
          >
            <Clipboard className="h-4 w-4 text-blue-600" aria-hidden="true" />
            {studyId}
            <span className="font-sans text-[10px] uppercase tracking-wider text-slate-500">{copied ? "Copied" : "Copy"}</span>
          </button>
        </header>

        <div className="grid gap-8 p-6 md:grid-cols-[minmax(300px,0.92fr)_minmax(0,1.08fr)] md:p-8">
          <div className="mx-auto w-full max-w-[430px] overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white p-3 shadow-sm">
            <Image
              src={imageSrc}
              alt={`${formLabel} QR code`}
              width={1890}
              height={1890}
              priority
              unoptimized
              className="h-auto w-full rounded-xl"
            />
          </div>

          <div className="flex flex-col justify-center">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">{title}</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Scan the QR code to continue</h2>
            <p className="mt-4 text-sm leading-7 text-slate-600">{description}</p>

            {unaided ? (
              <div className="mt-5 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-bold">Unaided assessment</p>
                  <p>Do not use the tutor, lecture slides, notes, search engines or another person while completing this quiz.</p>
                </div>
              </div>
            ) : null}

            <a
              href={formUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-5 text-sm font-bold text-blue-700 transition hover:bg-blue-100"
            >
              Open form directly <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>

            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-600">
              Enter the Study ID exactly as shown: <strong className="font-mono text-slate-950">{studyId}</strong>.
            </div>
            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 p-4 transition hover:bg-slate-50">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm leading-6 text-slate-700">{confirmationLabel}</span>
            </label>
            {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
            <button
              type="button"
              onClick={onConfirm}
              disabled={!confirmed || pending}
              className="mt-5 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 text-sm font-bold text-white shadow-lg shadow-blue-100 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
            >
              {pending ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
              {pending ? "Saving confirmation…" : confirmButtonLabel}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
