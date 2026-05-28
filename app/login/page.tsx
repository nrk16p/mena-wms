"use client"

import { signIn, useSession } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, Suspense } from "react"

const bgStyle: React.CSSProperties = {
  backgroundImage: "url('/mena-login.png')",
  backgroundSize: "cover",
  backgroundPosition: "center",
  backgroundRepeat: "no-repeat",
}

function LoginContent() {
  const { status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const error = searchParams.get("error")

  useEffect(() => {
    if (status === "authenticated") router.replace("/")
  }, [status, router])

  if (status === "loading") {
    return (
      <div className="fixed inset-0 flex items-center justify-center" style={bgStyle}>
        <div className="absolute inset-0 bg-black/30" />
        <div className="relative z-10 text-sm text-white/60">กำลังโหลด...</div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center" style={bgStyle}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative top-40 z-10 w-full max-w-md px-4">
        {/* Card */}
        <div className="rounded-2xl border border-white/20 bg-white/10 backdrop-blur-md px-8 py-8 shadow-xl">
          <p className="mb-6 text-center text-sm text-white/80">
            เข้าสู่ระบบด้วยบัญชี Google ของบริษัท
          </p>

          {error && (
            <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 px-4 py-3 text-sm text-red-600 dark:text-red-400 text-center">
              {error === "AccessDenied"
                ? "บัญชีนี้ไม่ได้รับอนุญาต — ใช้อีเมล @menatransport.co.th เท่านั้น"
                : "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง"}
            </div>
          )}

          <button
            onClick={() => signIn("google", { callbackUrl: "/" })}
            className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-xl border border-white/20 bg-white/90 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-white transition-colors shadow-sm"
          >
            {/* Google icon */}
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
              <path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332Z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
            </svg>
            Sign in with Google
          </button>

          <p className="mt-5 text-center text-[11px] text-white/50">
            รองรับเฉพาะบัญชี @menatransport.co.th
          </p>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  )
}
