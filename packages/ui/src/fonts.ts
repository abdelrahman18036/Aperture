import { Geist, Geist_Mono } from "next/font/google";

/**
 * Two self-hosted roles: clean modern interface copy and measured utility data.
 */
export const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

export const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const fontVariables = [geistSans.variable, geistMono.variable].join(" ");
