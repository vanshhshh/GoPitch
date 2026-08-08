import type { Metadata } from "next";
import { Toaster } from "react-hot-toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pitch-OS — Deck, matched investors, and outreach in one flow",
  description:
    "Generate your pitch deck, get matched with the right investors, and send personalized outreach — all from one platform built for founders raising a round.",
  openGraph: {
    title: "Pitch-OS",
    description: "Deck, matched investors, and outreach for founders raising a round.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            style: { background: "#15181C", color: "#F7F8F6", fontSize: "14px" },
            success: { iconTheme: { primary: "#1F6F5C", secondary: "#F7F8F6" } },
            error: { iconTheme: { primary: "#A23B34", secondary: "#F7F8F6" } },
          }}
        />
      </body>
    </html>
  );
}
