import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const inter = localFont({
  src: "../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  variable: "--inter-latin",
  weight: "100 900",
  display: "swap",
  adjustFontFallback: false,
});
const mono = localFont({
  src: "../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
  variable: "--mono-latin",
  weight: "100 800",
  display: "swap",
  adjustFontFallback: false,
});
export const metadata: Metadata = {
  title: "Nanogent",
  description: "Run a task. Review the change.",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
