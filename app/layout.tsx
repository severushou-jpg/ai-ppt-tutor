import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI PPT Tutor",
  description: "Choose the AI PPT Tutor product workspace or the controlled research study.",
  applicationName: "AI PPT Tutor",
  keywords: ["AI tutoring", "lecture learning", "PDF question answering", "RAG"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
