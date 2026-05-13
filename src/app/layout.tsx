import type { Metadata } from "next";
import { Geist, JetBrains_Mono, Noto_Sans_SC } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Toaster } from "@/components/ui/sonner";
import { APP_BRAND } from "@/lib/branding";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const notoSansSC = Noto_Sans_SC({
  variable: "--font-noto-sans-sc",
  weight: ["400", "500", "600", "700"],
  preload: false,
});

export const metadata: Metadata = {
  title: {
    template: APP_BRAND.titleTemplate,
    default: APP_BRAND.name,
  },
  description: APP_BRAND.description,
  icons: {
    icon: [
      { url: "/brand/rivalhub/favicon-32-transparent.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/rivalhub/icon-192-transparent.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      { url: "/brand/rivalhub/apple-touch-icon-transparent.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark">
      <body className={`${geist.variable} ${jetbrainsMono.variable} ${notoSansSC.variable} antialiased min-h-screen flex flex-col`}>
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
