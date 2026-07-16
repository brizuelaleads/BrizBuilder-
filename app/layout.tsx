import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });
const display = Instrument_Serif({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://brizbuilder-agency.rhkfgqqn2r.chatgpt.site"),
  title: {
    default: "Brizuela Leads — Agency CRM",
    template: "%s · Brizuela Leads",
  },
  description:
    "A secure CRM for lead-generation agencies and local service businesses.",
  openGraph: {
    title: "Brizuela Leads CRM",
    description: "Every lead, follow-up, and result in one protected workspace.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Brizuela Leads CRM",
    description: "Every lead, follow-up, and result in one protected workspace.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geist.variable} ${mono.variable} ${display.variable}`}>
        {children}
      </body>
    </html>
  );
}
