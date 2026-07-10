import "./globals.css"
import "./swal.css"
import "sweetalert2/dist/sweetalert2.min.css"
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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Mitr:wght@400;500;600&family=IBM+Plex+Sans+Thai:wght@300;400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="flex h-screen overflow-hidden bg-[#F6FAF7] dark:bg-[#0a0a10]">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  )
}
