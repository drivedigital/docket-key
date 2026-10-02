import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Docket-Key — NYSCEF Intelligence & Cross-Case Mind Maps",
  description: "Automated court docket scraper, PDF indexing, split document viewer, and cross-case evidence network mapping.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
