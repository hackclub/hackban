import "~/styles/globals.css";

import { type Metadata, type Viewport } from "next";
import { Inter } from "next/font/google";

import { ServiceWorker } from "~/app/_components/pwa";
import { themeScript } from "~/app/_components/theme";
import { TRPCReactProvider } from "~/trpc/react";

export const metadata: Metadata = {
  title: "Hackban",
  description: "Boards for Hack Club",
  applicationName: "Hackban",
  appleWebApp: { capable: true, title: "Hackban", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#22272b" },
  ],
  viewportFit: "cover",
};

// Trello's UI font is Atlassian Sans (proprietary, derived from Inter). We
// use it if installed locally and fall back to self-hosted Inter.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

const plausibleInit =
  "window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init()";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* Privacy-friendly analytics by Plausible */}
        <script async src="https://plausible.io/js/pa-CpPjndI2Bwc0JqspJWHBc.js" />
        <script dangerouslySetInnerHTML={{ __html: plausibleInit }} />
      </head>
      <body>
        <TRPCReactProvider>{children}</TRPCReactProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
