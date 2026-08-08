import Link from "next/link";
import {
  ArrowRight,
  BookOpenText,
  FlaskConical,
  GraduationCap,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

const versions = [
  {
    href: "/workspace",
    eyebrow: "Product Version",
    title: "Study your own lecture materials",
    description:
      "Upload PDF or PPTX files, explore visual content, ask questions and build a reusable learning workspace.",
    action: "Open product workspace",
    icon: GraduationCap,
    accent: "from-blue-600 to-cyan-500",
    surface: "border-blue-100 bg-blue-50/65",
  },
  {
    href: "/study/setup",
    eyebrow: "Research Study",
    title: "Relational Model learning study",
    description:
      "A controlled 25-minute study session using the fixed DBI Relational Model lecture material.",
    action: "Prepare study session",
    icon: FlaskConical,
    accent: "from-violet-600 to-indigo-500",
    surface: "border-violet-100 bg-violet-50/65",
  },
] as const;

export default function VersionSelectionPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f5f7fb] px-5 py-10 text-slate-900 sm:px-8 lg:px-12">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[31rem] bg-[radial-gradient(circle_at_18%_10%,rgba(59,130,246,0.14),transparent_34%),radial-gradient(circle_at_82%_2%,rgba(124,58,237,0.12),transparent_32%)]" />
      <div className="relative mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl flex-col justify-center">
        <header className="mb-10 max-w-3xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3.5 py-2 text-xs font-semibold tracking-[0.14em] text-slate-600 shadow-sm backdrop-blur">
            <Sparkles className="h-4 w-4 text-blue-600" aria-hidden="true" />
            AI-POWERED LECTURE LEARNING
          </div>
          <div className="mb-5 flex items-center gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-200">
              <BookOpenText className="h-7 w-7" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">AI-PPT Tutor</h1>
              <p className="mt-1 text-sm text-slate-500">Choose the environment you want to enter.</p>
            </div>
          </div>
          <p className="text-base leading-7 text-slate-600 sm:text-lg">
            The product workspace and the controlled research environment are deliberately separated so that
            study participants only see the features required by the experiment.
          </p>
        </header>

        <section className="grid gap-5 md:grid-cols-2" aria-label="Available versions">
          {versions.map((version) => {
            const Icon = version.icon;
            return (
              <Link
                key={version.href}
                href={version.href}
                className={`group flex min-h-80 flex-col rounded-[2rem] border p-7 shadow-[0_22px_60px_rgba(15,23,42,0.08)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_28px_70px_rgba(15,23,42,0.13)] focus-visible:outline-none ${version.surface}`}
              >
                <div className={`mb-8 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-lg ${version.accent}`}>
                  <Icon className="h-7 w-7" aria-hidden="true" />
                </div>
                <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                  {version.eyebrow}
                </p>
                <h2 className="text-2xl font-bold leading-tight tracking-tight text-slate-900">
                  {version.title}
                </h2>
                <p className="mt-4 flex-1 text-sm leading-6 text-slate-600">{version.description}</p>
                <span className="mt-8 inline-flex items-center gap-2 font-semibold text-slate-900">
                  {version.action}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </span>
              </Link>
            );
          })}
        </section>

        <footer className="mt-8 flex items-center gap-2 text-xs text-slate-500">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Research sessions use a fixed lecture and keep experimental controls outside the participant view.
        </footer>
      </div>
    </main>
  );
}
