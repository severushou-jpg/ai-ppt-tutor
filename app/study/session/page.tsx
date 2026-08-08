import { StudySessionClient } from "@/components/experiment/StudySessionClient";

export default async function StudySessionPage({
  searchParams,
}: {
  searchParams: Promise<{ studyId?: string }>;
}) {
  const params = await searchParams;
  return <StudySessionClient initialStudyId={params.studyId ?? ""} />;
}
