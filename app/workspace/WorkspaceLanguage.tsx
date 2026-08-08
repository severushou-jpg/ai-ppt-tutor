"use client";

import { useEffect, type ReactNode } from "react";

export function WorkspaceLanguage({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = "zh-CN";
    return () => {
      document.documentElement.lang = "en";
    };
  }, []);
  return children;
}
