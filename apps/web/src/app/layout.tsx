import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "APEX F1",
  description: "Experience every lap. An independent, unofficial F1 data experience.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
