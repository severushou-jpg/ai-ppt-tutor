"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookMarked,
  Check,
  CircleAlert,
  CircleCheck,
  FlaskConical,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  UserRoundCheck,
  RefreshCcw,
} from "lucide-react";
import {
  STUDY_MATERIAL_HASH,
  currentStudyKey,
  readApiError,
  studyTokenKey,
  type StudyCondition,
  type StudySession,
  type StudyStratum,
} from "../types";

const CONDITION_DETAILS: Record<
  StudyCondition,
  { grounding: boolean; attribution: boolean; description: string }
> = {
  A: { grounding: false, attribution: false, description: "Ungrounded response · no source markers" },
  B: { grounding: true, attribution: false, description: "Grounded response · no source markers" },
  C: { grounding: false, attribution: true, description: "Ungrounded response · source markers shown" },
  D: { grounding: true, attribution: true, description: "Grounded response · source markers shown" },
};

interface StudyPreflightResult {
  ready: boolean;
  checks: Record<string, { ok: boolean; label: string; detail: string }>;
  materialHash?: string | null;
}

function formatStudyId(value: string) {
  const digits = value.toUpperCase().replace(/[^0-9]/g, "").slice(0, 3);
  return digits ? `APTT-${digits}` : "APTT-";
}

export default function StudySetupPage() {
  const router = useRouter();
  const [studyId, setStudyId] = useState("APTT-");
  const [stratum, setStratum] = useState<StudyStratum | "">("");
  const [condition, setCondition] = useState<StudyCondition | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<StudyPreflightResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(true);
  const [preflightError, setPreflightError] = useState<string | null>(null);

  const ready = useMemo(
    () => preflight?.ready === true && /^APTT-\d{3}$/.test(studyId) && Boolean(stratum) && Boolean(condition) && !submitting,
    [condition, preflight?.ready, stratum, studyId, submitting],
  );

  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = "en";
    return () => {
      document.documentElement.lang = previous;
    };
  }, []);

  const runPreflight = useCallback(async () => {
    setPreflightLoading(true);
    setPreflightError(null);
    try {
      const response = await fetch("/api/study/preflight", { cache: "no-store" });
      if (!response.ok) throw new Error(await readApiError(response, "The study readiness check failed."));
      setPreflight(await response.json() as StudyPreflightResult);
    } catch (caught) {
      setPreflight(null);
      setPreflightError(caught instanceof Error ? caught.message : "The study readiness check failed.");
    } finally {
      setPreflightLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void runPreflight();
    });
    return () => {
      cancelled = true;
    };
  }, [runPreflight]);

  async function prepareSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || !stratum || !condition) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/study/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studyId,
          stratum,
          condition,
          metadata: {
            materialHash: STUDY_MATERIAL_HASH,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            locale: navigator.language,
          },
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, "The study session could not be prepared."));
      }
      const result = await response.json() as { session: StudySession; sessionToken: string };
      if (!result.sessionToken || result.session.studyId !== studyId) {
        throw new Error("The local study service returned an invalid session.");
      }
      sessionStorage.setItem(studyTokenKey(studyId), result.sessionToken);
      sessionStorage.setItem(currentStudyKey(), studyId);
      router.replace(`/study/session?studyId=${encodeURIComponent(studyId)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The study session could not be prepared.");
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f4f7fb] px-4 py-6 text-slate-900 sm:px-7 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-7 flex items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl px-2 py-2 text-sm font-medium text-slate-600 transition hover:bg-white hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Version selection
          </Link>
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-100 bg-white px-3.5 py-2 text-xs font-semibold text-violet-700 shadow-sm">
            <LockKeyhole className="h-4 w-4" aria-hidden="true" />
            Researcher setup only
          </div>
        </header>

        <div className="grid overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.10)] lg:grid-cols-[0.78fr_1.22fr]">
          <aside className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-blue-900 p-8 text-white sm:p-10">
            <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-blue-400/15 blur-3xl" />
            <div className="relative">
              <div className="mb-7 grid h-14 w-14 place-items-center rounded-2xl bg-white/12 ring-1 ring-white/20">
                <FlaskConical className="h-7 w-7" aria-hidden="true" />
              </div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-200">AI-PPT Tutor Study</p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight">Prepare a participant session</h1>
              <p className="mt-5 max-w-md text-sm leading-6 text-blue-100/85">
                Configure the participant before handing over the computer. The assigned condition is not shown
                after the participant page opens.
              </p>

              <div className="mt-10 space-y-4 text-sm">
                <div className="flex gap-3 rounded-2xl border border-white/10 bg-white/7 p-4">
                  <BookMarked className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" aria-hidden="true" />
                  <div>
                    <p className="font-semibold">Fixed study material</p>
                    <p className="mt-1 text-xs leading-5 text-blue-100/70">DBI · The Relational Model</p>
                  </div>
                </div>
                <div className="flex gap-3 rounded-2xl border border-white/10 bg-white/7 p-4">
                  <UserRoundCheck className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" aria-hidden="true" />
                  <div>
                    <p className="font-semibold">One participant, one record folder</p>
                    <p className="mt-1 text-xs leading-5 text-blue-100/70">
                      Recording begins only after Start Learning is pressed.
                    </p>
                  </div>
                </div>
                <div className="flex gap-3 rounded-2xl border border-white/10 bg-white/7 p-4">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" aria-hidden="true" />
                  <div>
                    <p className="font-semibold">Up to 25 minutes of learning</p>
                    <p className="mt-1 text-xs leading-5 text-blue-100/70">
                      The lecture and chat lock at the time limit or after a confirmed early finish.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </aside>

          <form className="p-7 sm:p-10" onSubmit={prepareSession}>
            <div className="mb-8">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-600">Session details</p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight">Assign the study configuration</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Review all three fields carefully. The condition is fixed after the session is created.
              </p>
            </div>

            <div className="space-y-8">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">Study ID</span>
                <input
                  value={studyId}
                  onChange={(event) => setStudyId(formatStudyId(event.target.value))}
                  autoComplete="off"
                  inputMode="numeric"
                  aria-describedby="study-id-hint"
                  className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 font-mono text-base font-semibold uppercase tracking-wider text-slate-900 transition focus:border-blue-400 focus:bg-white"
                  placeholder="APTT-001"
                />
                <span id="study-id-hint" className="mt-2 block text-xs text-slate-500">
                  Required format: APTT-###. Existing records cannot be overwritten.
                </span>
              </label>

              <fieldset>
                <legend className="text-sm font-semibold text-slate-800">Prior database experience</legend>
                <p className="mb-3 mt-1 text-xs leading-5 text-slate-500">
                  Used only to balance participants across conditions; it does not change the tutor&apos;s responses.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {([
                    ["novice", "Novice", "Has not previously studied the relational model."],
                    ["experienced", "Experienced", "Has previously studied the relational model."],
                  ] as const).map(([value, label, description]) => (
                    <label
                      key={value}
                      className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3.5 text-sm font-medium transition ${
                        stratum === value
                          ? "border-blue-400 bg-blue-50 text-blue-900 ring-2 ring-blue-100"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                      }`}
                    >
                      <input
                        type="radio"
                        name="stratum"
                        value={value}
                        checked={stratum === value}
                        onChange={() => setStratum(value)}
                        className="sr-only"
                      />
                      <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${stratum === value ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300"}`}>
                        {stratum === value ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
                      </span>
                      <span>
                        <span className="block">{label}</span>
                        <span className={`mt-0.5 block text-xs font-normal leading-5 ${stratum === value ? "text-blue-700" : "text-slate-500"}`}>
                          {description}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="mb-3 text-sm font-semibold text-slate-800">Experimental condition</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(Object.keys(CONDITION_DETAILS) as StudyCondition[]).map((value) => {
                    const details = CONDITION_DETAILS[value];
                    return (
                      <label
                        key={value}
                        className={`cursor-pointer rounded-xl border p-4 transition ${
                          condition === value
                            ? "border-violet-400 bg-violet-50 ring-2 ring-violet-100"
                            : "border-slate-200 bg-white hover:border-slate-300"
                        }`}
                      >
                        <input
                          type="radio"
                          name="condition"
                          value={value}
                          checked={condition === value}
                          onChange={() => setCondition(value)}
                          className="sr-only"
                        />
                        <span className="flex items-center justify-between">
                          <span className="text-sm font-bold text-slate-900">Condition {value}</span>
                          <span className={`grid h-5 w-5 place-items-center rounded-full border ${condition === value ? "border-violet-600 bg-violet-600 text-white" : "border-slate-300"}`}>
                            {condition === value ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
                          </span>
                        </span>
                        <span className="mt-2 block text-xs leading-5 text-slate-500">{details.description}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </div>

            {error ? (
              <div role="alert" className="mt-7 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            ) : null}

            <section className="mt-7 rounded-2xl border border-slate-200 bg-slate-50 p-4" aria-labelledby="readiness-heading">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 id="readiness-heading" className="text-sm font-bold text-slate-900">Study system readiness</h3>
                  <p className="mt-0.5 text-xs text-slate-500">All checks must pass before a participant session can be created.</p>
                </div>
                {preflightLoading ? <LoaderCircle className="h-5 w-5 animate-spin text-blue-600" aria-label="Checking system readiness" /> : null}
              </div>
              {preflight ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {Object.entries(preflight.checks).map(([key, check]) => (
                    <div key={key} className={`flex gap-2.5 rounded-xl border bg-white px-3 py-2.5 ${check.ok ? "border-emerald-100" : "border-red-200"}`}>
                      {check.ok
                        ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                        : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />}
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-800">{check.label}</p>
                        <p className="mt-0.5 truncate text-[10px] text-slate-500" title={check.detail}>{check.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {preflightError || (preflight && !preflight.ready) ? (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
                  <span>{preflightError ?? "One or more study checks failed. Resolve the issue before continuing."}</span>
                  <button type="button" onClick={() => void runPreflight()} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 font-semibold shadow-sm hover:bg-red-100">
                    <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    Retry
                  </button>
                </div>
              ) : null}
            </section>

            <button
              type="submit"
              disabled={!ready}
              className="mt-8 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white shadow-lg shadow-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
            >
              {submitting ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Preparing session…
                </>
              ) : (
                <>
                  Prepare study session
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
