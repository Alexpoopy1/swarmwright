import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Swarmwright — Autonomous AI Development Workspace",
  description:
    "Connect any AI provider, coordinate autonomous agent swarms, and build software through a visual, controllable workspace.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
