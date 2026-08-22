import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Navbar } from "@/components/Navbar";
import { Toaster } from "@/components/Toaster";
import { TickerTape } from "@/components/TickerTape";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Umbra — options on Stellar",
  description: "European, cash-settled options trading on Soroban. Testnet MVP.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-umbra-bg font-sans text-umbra-ink antialiased">
        <div className="pointer-events-none fixed inset-0 bg-umbra-radial" />
        <div className="pointer-events-none fixed inset-0 bg-noise" />
        <Providers>
          <div className="relative flex min-h-screen flex-col">
            <Navbar />
            <TickerTape />
            <main className="mx-auto w-full max-w-[1760px] flex-1 px-3 pb-16 pt-3 sm:px-4">{children}</main>
            <footer className="border-t border-umbra-border-soft px-4 py-6 text-center text-xs text-umbra-faint sm:px-6 lg:px-8">
              Umbra · Soroban testnet MVP · full collateral, cash-settled, European exercise
            </footer>
          </div>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
