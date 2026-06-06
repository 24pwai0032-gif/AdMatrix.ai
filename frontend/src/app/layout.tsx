import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AdMatrix.ai — Localized Video Ads, Automatically",
  description:
    "AdMatrix.ai turns any product URL into a localized, on-brand video ad using a multi-agent pipeline powered by Qwen Cloud.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
