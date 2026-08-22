import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Toaster } from "@/components/Toaster";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Umbra — options on Stellar",
  description: "European, cash-settled options trading on Soroban. Testnet MVP.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="h-screen overflow-hidden bg-umbra-bg font-sans text-umbra-ink antialiased">
        <Providers>
          <div className="flex h-screen flex-col">{children}</div>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
