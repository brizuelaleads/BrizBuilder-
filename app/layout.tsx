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
  metadataBase: new URL("https://brizbuilder.com"),
  title: {
    default: "BrizBuilder | Websites for service businesses",
    template: "%s | BrizBuilder",
  },
  description:
    "A website launch and client-management platform for agencies serving local service businesses.",
  openGraph: {
    title: "BrizBuilder",
    description:
      "Launch service-business websites and manage client leads from one workspace.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "BrizBuilder",
    description:
      "Launch service-business websites and manage client leads from one workspace.",
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
