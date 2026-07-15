import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI PPT Tutor｜课件学习工作区",
  description: "上传 PDF 或 PPTX，让 AI 基于课件进行讲解、问答、练习与复习，并提供可核查的来源引用。",
  applicationName: "AI PPT Tutor",
  keywords: ["AI 学习", "课件讲解", "PPT 学习", "PDF 问答", "RAG"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
