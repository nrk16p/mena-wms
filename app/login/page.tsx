"use client"

import { signIn, useSession } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, Suspense } from "react"

const bgStyle: React.CSSProperties = {
  backgroundImage: "url('/mena-login.png')",
  backgroundSize: "cover",
  backgroundPosition: "center",
  backgroundRepeat: "no-repeat",
  backgroundPositionX: "left",
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
        <div className="absolute inset-0 bg-black/10" />
        <div className="relative z-10 text-[10px] tracking-[0.3em] text-white/35 uppercase">Loading</div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center" style={bgStyle}>
      <div className="absolute inset-0 bg-black/10" />

      <div className="relative z-10 w-full max-w-xs px-6" style={{ transform: "scale(1.25)" }}>
       

        {/* Card */}
        <div className="rounded-2xl border border-white/10 bg-white/8 backdrop-blur-md px-6 py-7">
           {/* Brand */}
        <div className="mb-4 text-center">
          <h1 className="text-2xl font-extrabold tracking-[0.2em] bg-clip-text text-transparent bg-linear-to-r from-emerald-700 via-emerald-500 to-emerald-400 uppercase mb-1">
            Mena WMS
          </h1>
          <div className="flex items-center justify-center gap-2 my-2.5">
            <div className="h-px w-8 bg-emerald-400/35" />
            <div className="h-1 w-1 rounded-full bg-emerald-400/70" />
            <div className="h-px w-8 bg-emerald-400/35" />
          </div>
          <p className="text-md font-medium text-black/60 ">
            Warehouse Management System
          </p>
        </div>
          
          {error && (
            <div className="mb-5 rounded-lg border border-red-400/20 bg-red-500/10 px-4 py-3 text-[11px] text-red-300 text-center leading-relaxed">
              {error === "AccessDenied"
                ? "บัญชีนี้ไม่ได้รับอนุญาต — ใช้อีเมล @menatransport.co.th เท่านั้น"
                : "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง"}
            </div>
          )}

          <button
            onClick={() => signIn("google", { callbackUrl: "/?welcome=1" })}
            className="flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-xl bg-white px-4 py-2.5 text-[13px] font-medium text-gray-700 hover:bg-white/90 transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4" />
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853" />
              <path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332Z" fill="#FBBC05" />
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335" />
            </svg>
            Sign in with Google
          </button>

          <p className="mt-4 text-center text-[11px] tracking-wide text-white">
            @menatransport.co.th <span className="font-medium text-[12px] text-red-700 ml-1">only</span>
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
