import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI-PPT Tutor Research Study",
  description: "Controlled learning study using the DBI Relational Model lecture.",
  robots: { index: false, follow: false },
};

export default function StudyLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
