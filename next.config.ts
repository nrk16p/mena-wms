import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ฟอนต์ PDF อ่านจาก process.cwd()/fonts ตอนรันบน Vercel — ต้องบอก tracer ให้รวมเข้า bundle ของ route นี้
  outputFileTracingIncludes: {
    "/api/price-compare/[id]/pdf": ["./fonts/**"],
  },
  // pdfmake ใช้ subpath import + virtualfs — ให้ Node โหลดตรงจาก node_modules แทนการ bundle
  serverExternalPackages: ["pdfmake", "sharp"],
};

export default nextConfig;
