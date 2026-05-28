import "./globals.css"
import { Providers } from "@/components/providers"
import { AppShell } from "@/components/app-shell"

export const metadata = {
  title: "Mena WMS",
  description: "Warehouse Management System — Mena Transport",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}})()`,
          }}
        />
      </head>
      <body className="flex h-screen overflow-hidden bg-[#f5f5f7] dark:bg-[#0a0a10]">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  )
}
