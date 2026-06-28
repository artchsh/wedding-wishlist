import type { Metadata } from "next";
import { JetBrains_Mono, Russo_One } from "next/font/google";
import "./globals.css";

const russoOne = Russo_One({
  variable: "--font-russo-one",
  subsets: ["latin", "cyrillic"],
  weight: "400",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: "Свадьба Гея и Би",
  description: "Свадебный список подарков.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={`dark ${russoOne.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
