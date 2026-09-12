import type { Metadata } from "next";
import { Geist, JetBrains_Mono, Noto_Sans_SC } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Toaster } from "@/components/ui/sonner";
import { APP_BRAND } from "@/lib/branding";
import { GlobalInformationFeedbackLauncher } from "@/components/operations/GlobalInformationFeedbackLauncher";
import { OperationsProvider } from "@/components/operations/OperationsContext";
import { Suspense } from "react";
import { isPreview } from "@/lib/runtime/preview";
import { readPreviewMirrorIdentity } from "@/lib/preview/mirror-state";

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const mirror = isPreview() ? await readPreviewMirrorIdentity() : null;
  return (
    <html lang="zh-CN" className="dark">
      <head>
        <link rel="stylesheet" href="/brackets-viewer.min.css" />
      </head>
      <body className={`${geist.variable} ${jetbrainsMono.variable} ${notoSansSC.variable} antialiased min-h-screen flex flex-col`}>
        <OperationsProvider>
          {isPreview() && <aside className="border-b border-border bg-muted px-4 py-2 text-center text-xs text-muted-foreground">
            <span className="font-mono">PR PREVIEW</span> · 脱敏镜像，只读浏览 · {mirror?.ready ? `镜像 ${mirror.sourceTag} · ${mirror.refreshedAt.toLocaleString("zh-CN")}` : "镜像尚未就绪"} · 角色测试请使用 dev 专属账号
          </aside>}
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
          <Suspense fallback={null}>
            <GlobalInformationFeedbackLauncher />
          </Suspense>
        </OperationsProvider>
        <Toaster richColors position="top-right" />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
