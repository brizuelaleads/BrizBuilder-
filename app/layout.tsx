import type { Metadata } from "next";
import {
  Geist,
  Geist_Mono,
  Instrument_Serif,
  Rajdhani,
  Share_Tech_Mono,
} from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });
const display = Instrument_Serif({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});
// Cyberpunk theme fonts. Only referenced through the --crm-font-* theme
// tokens, so the classic theme never uses (or downloads) them.
const cyberDisplay = Rajdhani({
  variable: "--font-cyber-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  preload: false,
});
const cyberMono = Share_Tech_Mono({
  variable: "--font-cyber-mono",
  subsets: ["latin"],
  weight: "400",
  preload: false,
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
    images: [
      {
        url: "/og-calm.png",
        alt: "BrizBuilder calm agency workspace preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "BrizBuilder",
    description:
      "Launch service-business websites and manage client leads from one workspace.",
    images: ["/og-calm.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geist.variable} ${mono.variable} ${display.variable} ${cyberDisplay.variable} ${cyberMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
