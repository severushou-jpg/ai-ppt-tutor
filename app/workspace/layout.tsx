import type { Metadata } from "next";
import { WorkspaceLanguage } from "./WorkspaceLanguage";

export const metadata: Metadata = {
  title: "AI PPT Tutor｜课件学习工作区",
  description: "上传 PDF 或 PPTX，让 AI 基于课件进行讲解、问答、练习与复习，并提供可核查的来源引用。",
};

export default function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <WorkspaceLanguage>{children}</WorkspaceLanguage>;
}
