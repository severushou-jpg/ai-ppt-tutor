"use client";

import { CheckCircle2, CircleAlert, LoaderCircle, LockKeyhole } from "lucide-react";
import { StudyFormQrStep } from "./StudyFormQrStep";
import type { StudyParticipantStage } from "@/app/study/types";
import { STUDY_FORMS } from "@/lib/study/protocol-config.js";

interface PostStudyFlowProps {
  studyId: string;
  stage: StudyParticipantStage;
  finalizationStatus: "idle" | "saving" | "saved" | "retrying";
  endedEarly: boolean;
  pending: boolean;
  error: string | null;
  onConfirmForm3: () => void;
  onConfirmForm2: () => void;
  onPrepareNextParticipant: () => void;
}

export function PostStudyFlow({
  studyId,
  stage,
  finalizationStatus,
  endedEarly,
  pending,
  error,
  onConfirmForm3,
  onConfirmForm2,
  onPrepareNextParticipant,
}: PostStudyFlowProps) {
  if (finalizationStatus !== "saved") {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-center text-white">
        <section className="w-full max-w-lg rounded-[2rem] border border-white/15 bg-white/10 p-8 shadow-2xl backdrop-blur sm:p-10">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white/10">
            <LockKeyhole className="h-8 w-8 text-blue-200" aria-hidden="true" />
          </div>
          <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-blue-200">Learning session closed</p>
          <h1 className="mt-3 text-2xl font-bold">Securing the research record…</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            The tutor and lecture are locked. Keep this page open; the forms will appear only after the research record has been saved successfully.
          </p>
          <div className="mx-auto mt-6 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold">
            <LoaderCircle className="h-4 w-4 animate-spin text-blue-200" aria-hidden="true" />
            {finalizationStatus === "retrying" ? "Retrying secure save…" : "Saving…"}
          </div>
          {finalizationStatus === "retrying" && error ? (
            <p role="alert" className="mt-4 text-xs leading-5 text-amber-200">{error}</p>
          ) : null}
        </section>
      </main>
    );
  }

  if (stage === "form3") {
    return (
      <StudyFormQrStep
        key="form3"
        studyId={studyId}
        formLabel="Form 3 — Unaided Quiz"
        title={endedEarly ? "Learning finished early · Step 1 of 2" : "25-minute learning complete · Step 1 of 2"}
        description="Complete Form 3 now. The tutor response, chat history and original lecture have been removed from this screen so the quiz remains unaided. Submit Form 3 before continuing."
        imageSrc={STUDY_FORMS.form3.publicPath}
        formUrl={STUDY_FORMS.form3.url}
        confirmationLabel="I confirm that I have submitted Form 3 — Unaided Quiz without using the tutor, lecture or notes."
        confirmButtonLabel="Form 3 Submitted — Continue to Form 2"
        pending={pending}
        error={error}
        unaided
        onConfirm={onConfirmForm3}
      />
    );
  }

  if (stage === "form2") {
    return (
      <StudyFormQrStep
        key="form2"
        studyId={studyId}
        formLabel="Form 2 — Post-Learning Questionnaire"
        title="Step 2 of 2"
        description="Complete the post-learning questionnaire after Form 3. Answer based on the learning session you have just completed, then submit the form."
        imageSrc={STUDY_FORMS.form2.publicPath}
        formUrl={STUDY_FORMS.form2.url}
        confirmationLabel="I confirm that I have submitted Form 2 — Post-Learning Questionnaire."
        confirmButtonLabel="Form 2 Submitted — Complete Study"
        pending={pending}
        error={error}
        onConfirm={onConfirmForm2}
      />
    );
  }

  if (stage === "done") {
    return (
      <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#f4f7fb] p-5">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_5%,rgba(16,185,129,0.14),transparent_36%),radial-gradient(circle_at_85%_12%,rgba(37,99,235,0.13),transparent_34%)]" />
        <section className="relative w-full max-w-xl rounded-[2rem] border border-emerald-200 bg-white p-8 text-center shadow-[0_30px_90px_rgba(15,23,42,0.14)] sm:p-10">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="h-9 w-9" aria-hidden="true" />
          </div>
          <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Experiment complete</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Thank you for participating.</h1>
          <p className="mt-4 text-sm leading-7 text-slate-600">
            The learning session, unaided quiz and post-learning questionnaire are complete for <strong className="font-mono text-slate-900">{studyId}</strong>.
          </p>
          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm font-bold text-slate-800">
            Please return the computer to the researcher.
          </div>
          <button
            type="button"
            onClick={onPrepareNextParticipant}
            className="mt-5 inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-xs font-bold text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
          >
            Researcher: Prepare Next Participant
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#f4f7fb] p-6">
      <section className="max-w-md rounded-3xl border border-amber-200 bg-white p-8 text-center shadow-xl">
        <CircleAlert className="mx-auto h-10 w-10 text-amber-500" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-bold">Post-study step unavailable</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">Please return the computer to the researcher.</p>
      </section>
    </main>
  );
}
