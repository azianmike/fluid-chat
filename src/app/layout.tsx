import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "OpenChat",
  description: "Self-hosted Slack alternative for small teams"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
