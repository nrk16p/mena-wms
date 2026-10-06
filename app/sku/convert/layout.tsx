import { Noto_Sans_Thai, Prompt } from "next/font/google"
import "./v2.css"

// Scoped menaIT V.2 fonts — only the convert pages load these (variables are used inside .v2-scope).
const prompt = Prompt({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-v2-prompt",
  display: "swap",
})
const noto = Noto_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600"],
  variable: "--font-v2-noto",
  display: "swap",
})

export default function ConvertLayout({ children }: { children: React.ReactNode }) {
  // Negative margins cancel the WMS <main> padding so the canvas/hero run edge to edge.
  return (
    <div className={`v2-scope v2-canvas ${prompt.variable} ${noto.variable} -mx-3 -my-4 min-h-full lg:-mx-7 lg:-my-6`}>
      {children}
    </div>
  )
}
