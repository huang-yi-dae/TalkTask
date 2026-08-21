import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Geist, Geist_Mono } from "next/font/google";
import { EazoProvider } from "@/lib/eazo-shim";
import { GlobalAuthModal } from "@/components/auth/global-auth-modal";
import { cn } from "@/utils/utils";
import { Toaster } from "@/components/ui/sonner";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { LocaleSyncEffect } from "@/components/i18n/locale-sync-effect";
import { getServerLocale } from "@/lib/i18n/server-preference";
import { getCurrentUser } from "@/lib/auth/current-user";
import { UserProvider } from "@/lib/auth/user-provider";

const geist = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-geist",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-geist-mono",
});

const SITE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : undefined;

const SITE_TITLE = process.env.NEXT_PUBLIC_APP_TITLE?.trim() || "拾级";
const SITE_DESCRIPTION =
  process.env.NEXT_PUBLIC_APP_DESCRIPTION?.trim() ||
  "Type a goal, let AI plan the rest.";

export const metadata: Metadata = {
  ...(SITE_URL ? { metadataBase: new URL(SITE_URL) } : {}),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: SITE_TITLE,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getServerLocale();
  // RSC 阶段直接读 cookie 解出 user —— 首屏零闪烁
  // （详见 docs/plans/2026-08-14-multi-user-isolation.md §Phase 5）
  const user = await getCurrentUser();

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={cn("h-full antialiased", geist.variable, geistMono.variable)}
    >
      <body className="h-full flex flex-col overflow-hidden">
        <I18nProvider>
          <UserProvider user={user}>
            <EazoProvider>
              <LocaleSyncEffect />
              {children}
              <GlobalAuthModal />
              <Toaster />
            </EazoProvider>
          </UserProvider>
        </I18nProvider>
      </body>
    </html>
  );
}