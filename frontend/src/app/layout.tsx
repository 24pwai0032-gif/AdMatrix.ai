import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AdMatrix.ai Dashboard",
  description: "AI-powered multilingual video ad production",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
