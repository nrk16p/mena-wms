"use client"

import { useState, useRef, useEffect } from "react"
import {
  X, BookOpen, LogIn, LayoutDashboard, PackageSearch,
  PlusCircle, Inbox, Layers, Car, Database, Clock, Eye, EyeOff,
} from "lucide-react"

// ── SVG Visual Mockups ──────────────────────────────────────────────

function VisualLoginGoogle() {
  return (
    <svg viewBox="0 0 380 180" className="w-full rounded-xl" aria-label="Login page">
      <rect width="380" height="180" fill="#0b1120" rx="10" />
      <rect x="115" y="14" width="150" height="152" rx="14" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.12)" strokeWidth="0.8" />
      <text x="190" y="44" textAnchor="middle" fill="#10b981" fontSize="12" fontWeight="800" letterSpacing="4">MENA WMS</text>
      <text x="190" y="58" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="7.5">Warehouse Management System</text>
      <rect x="131" y="72" width="118" height="30" rx="9" fill="white" />
      <text x="190" y="91" textAnchor="middle" fill="#374151" fontSize="9.5" fontWeight="500">Sign in with Google</text>
      <rect x="128" y="69" width="124" height="36" rx="11" fill="none" stroke="#10b981" strokeWidth="2" />
      <rect x="125" y="66" width="130" height="42" rx="13" fill="none" stroke="#10b981" strokeWidth="1" opacity="0.3" />
      <text x="258" y="81" fill="#10b981" fontSize="8.5" fontWeight="600">กดตรงนี้</text>
      <line x1="256" y1="84" x2="250" y2="90" stroke="#10b981" strokeWidth="1.5" />
      <text x="190" y="125" textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="7.5">ต้องใช้อีเมล @menatransport.co.th</text>
      <rect x="128" y="134" width="124" height="18" rx="5" fill="rgba(239,68,68,0.1)" stroke="rgba(239,68,68,0.3)" strokeWidth="0.8" />
      <text x="190" y="146" textAnchor="middle" fill="#ef4444" fontSize="7.5">บัญชีอื่น → แสดง error สีแดง</text>
    </svg>
  )
}

function VisualSKUFilter() {
  return (
    <svg viewBox="0 0 400 180" className="w-full rounded-xl" aria-label="SKU filter bar">
      <rect width="400" height="180" fill="#f8fafc" rx="10" />
      <rect width="400" height="38" fill="white" />
      <rect y="37" width="400" height="0.8" fill="#e2e8f0" />
      <text x="12" y="24" fill="#1e293b" fontSize="12" fontWeight="700">รายการ SKU</text>
      <rect x="8" y="44" width="384" height="44" rx="8" fill="white" stroke="#e2e8f0" strokeWidth="0.8" />
      <rect x="14" y="53" width="68" height="20" rx="5" fill="#f1f5f9" stroke="#e2e8f0" strokeWidth="0.6" />
      <text x="48" y="66.5" textAnchor="middle" fill="#64748b" fontSize="7.5">Warehouse ▾</text>
      <rect x="88" y="53" width="72" height="20" rx="5" fill="#f1f5f9" stroke="#e2e8f0" strokeWidth="0.6" />
      <text x="124" y="66.5" textAnchor="middle" fill="#64748b" fontSize="7.5">Exp. Type ▾</text>
      <rect x="166" y="53" width="40" height="20" rx="5" fill="#f1f5f9" stroke="#e2e8f0" strokeWidth="0.6" />
      <text x="186" y="66.5" textAnchor="middle" fill="#64748b" fontSize="7.5">L1 ▾</text>
      <rect x="212" y="53" width="40" height="20" rx="5" fill="#f1f5f9" stroke="#e2e8f0" strokeWidth="0.6" />
      <text x="232" y="66.5" textAnchor="middle" fill="#64748b" fontSize="7.5">L2 ▾</text>
      <rect x="258" y="53" width="40" height="20" rx="5" fill="#f1f5f9" stroke="#e2e8f0" strokeWidth="0.6" />
      <text x="278" y="66.5" textAnchor="middle" fill="#64748b" fontSize="7.5">L3 ▾</text>
      <rect x="306" y="53" width="78" height="20" rx="5" fill="#f1f5f9" stroke="#e2e8f0" strokeWidth="0.6" />
      <text x="345" y="66.5" textAnchor="middle" fill="#94a3b8" fontSize="7.5">🔍 ค้นหา...</text>
      <rect x="6" y="42" width="388" height="48" rx="10" fill="none" stroke="#10b981" strokeWidth="2" />
      <text x="200" y="103" textAnchor="middle" fill="#10b981" fontSize="8.5" fontWeight="600">↑ Filter Bar — กรองได้จากทุก dropdown</text>
      {[0, 1, 2].map(i => (
        <g key={i}>
          <rect x="8" y={112 + i * 22} width="384" height="20" fill={i % 2 === 0 ? "white" : "#f8fafc"} stroke="#e2e8f0" strokeWidth="0.3" />
          <rect x="14" y={116 + i * 22} width="55" height="11" rx="3" fill="#e2e8f0" />
          <rect x="78" y={116 + i * 22} width="90" height="11" rx="3" fill="#e2e8f0" />
          <rect x="178" y={116 + i * 22} width="50" height="11" rx="3" fill="#e2e8f0" />
          <rect x="238" y={116 + i * 22} width="40" height="11" rx="3" fill="#e2e8f0" />
        </g>
      ))}
    </svg>
  )
}

function VisualSKURow() {
  return (
    <svg viewBox="0 0 400 140" className="w-full rounded-xl" aria-label="Click row to open SKU">
      <rect width="400" height="140" fill="#f8fafc" rx="10" />
      {[0, 1, 2].map(i => (
        <g key={i}>
          <rect x="8" y={12 + i * 28} width="384" height="26" rx={i === 1 ? "8" : "4"} fill={i === 1 ? "#f0fdf4" : "white"} stroke={i === 1 ? "#86efac" : "#e2e8f0"} strokeWidth={i === 1 ? "1.5" : "0.5"} />
          <rect x="16" y={18 + i * 28} width="60" height="12" rx="3" fill={i === 1 ? "#bbf7d0" : "#e2e8f0"} />
          <rect x="84" y={18 + i * 28} width="110" height="12" rx="3" fill="#e2e8f0" />
          <rect x="204" y={18 + i * 28} width="60" height="12" rx="3" fill="#e2e8f0" />
          <rect x="274" y={18 + i * 28} width="50" height="12" rx="3" fill="#e2e8f0" />
          {i === 1 && <text x="342" y={31 + i * 28} fill="#15803d" fontSize="8.5" fontWeight="600">กดเพื่อเปิด →</text>}
        </g>
      ))}
      <rect x="6" y={12 + 1 * 28} width="388" height="26" rx="10" fill="none" stroke="#10b981" strokeWidth="2" />
      <text x="200" y="104" textAnchor="middle" fill="#10b981" fontSize="8.5" fontWeight="600">กดที่แถวใดก็ได้เพื่อเปิด/แก้ไข SKU</text>
      <text x="200" y="118" textAnchor="middle" fill="#94a3b8" fontSize="7.5">Warehouse, Type, L1-L2-L3 จะล็อก — แก้ไม่ได้</text>
      <text x="200" y="130" textAnchor="middle" fill="#94a3b8" fontSize="7.5">ชื่อ, ราคา, Brand, ยานพาหนะ — แก้ไขได้</text>
    </svg>
  )
}

function VisualCascadeDropdown() {
  return (
    <svg viewBox="0 0 400 190" className="w-full rounded-xl" aria-label="Cascade dropdowns">
      <rect width="400" height="190" fill="#f8fafc" rx="10" />
      <text x="12" y="20" fill="#1e293b" fontSize="11" fontWeight="700">เพิ่ม SKU ใหม่ · เลือก Category</text>
      <text x="12" y="38" fill="#64748b" fontSize="7.5">① Warehouse</text>
      <rect x="12" y="42" width="88" height="22" rx="6" fill="white" stroke="#10b981" strokeWidth="1.5" />
      <text x="56" y="57" textAnchor="middle" fill="#1e293b" fontSize="9" fontWeight="500">BKK ▾</text>
      <line x1="102" y1="53" x2="115" y2="53" stroke="#10b981" strokeWidth="1.5" markerEnd="url(#a1)" />
      <text x="120" y="38" fill="#64748b" fontSize="7.5">② Expense Type</text>
      <rect x="120" y="42" width="88" height="22" rx="6" fill="white" stroke="#10b981" strokeWidth="1.5" />
      <text x="164" y="57" textAnchor="middle" fill="#1e293b" fontSize="9" fontWeight="500">W/S ▾</text>
      <line x1="210" y1="53" x2="223" y2="53" stroke="#10b981" strokeWidth="1.5" markerEnd="url(#a2)" />
      <text x="228" y="38" fill="#64748b" fontSize="7.5">③ L1 System</text>
      <rect x="228" y="42" width="88" height="22" rx="6" fill="white" stroke="#10b981" strokeWidth="1.5" />
      <text x="272" y="57" textAnchor="middle" fill="#1e293b" fontSize="9" fontWeight="500">ENG ▾</text>
      <line x1="272" y1="64" x2="272" y2="78" stroke="#10b981" strokeWidth="1" strokeDasharray="3 2" />
      <line x1="80" y1="78" x2="280" y2="78" stroke="#10b981" strokeWidth="1" strokeDasharray="3 2" />
      <line x1="80" y1="78" x2="80" y2="90" stroke="#10b981" strokeWidth="1" strokeDasharray="3 2" />
      <line x1="220" y1="78" x2="220" y2="90" stroke="#10b981" strokeWidth="1" strokeDasharray="3 2" />
      <text x="12" y="100" fill="#64748b" fontSize="7.5">④ L2 Sub-assembly</text>
      <rect x="12" y="104" width="140" height="22" rx="6" fill="white" stroke="#94a3b8" strokeWidth="1" />
      <text x="82" y="119" textAnchor="middle" fill="#64748b" fontSize="8.5">เลือก L2... ▾</text>
      <text x="165" y="100" fill="#64748b" fontSize="7.5">⑤ L3 Component</text>
      <rect x="165" y="104" width="140" height="22" rx="6" fill="white" stroke="#cbd5e1" strokeWidth="0.8" />
      <text x="235" y="119" textAnchor="middle" fill="#cbd5e1" fontSize="8.5">เลือก L3... ▾</text>
      <text x="200" y="148" textAnchor="middle" fill="#10b981" fontSize="8.5" fontWeight="600">เลือกตามลำดับ — dropdown จะ filter อัตโนมัติ</text>
      <rect x="70" y="156" width="260" height="22" rx="6" fill="rgba(16,185,129,0.08)" stroke="rgba(16,185,129,0.3)" strokeWidth="0.8" />
      <text x="200" y="170" textAnchor="middle" fill="#10b981" fontSize="8.5" fontWeight="500">SKU Code จะสร้างอัตโนมัติ: BKK-WS-ENG-…-0001</text>
      <defs>
        <marker id="a1" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#10b981" /></marker>
        <marker id="a2" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#10b981" /></marker>
      </defs>
    </svg>
  )
}

function VisualFormFields() {
  return (
    <svg viewBox="0 0 400 262" className="w-full rounded-xl" aria-label="SKU form fields layout">
      <rect width="400" height="262" fill="#f8fafc" rx="10" />
      <text x="12" y="16" fill="#1e293b" fontSize="11" fontWeight="700">ฟิลด์ในฟอร์ม เพิ่ม SKU ใหม่</text>

      {/* Row 1: SKU Preview | ATMS Code */}
      <rect x="8" y="22" width="186" height="28" rx="6" fill="white" stroke="#e2e8f0" strokeWidth="0.8" />
      <text x="14" y="32" fill="#94a3b8" fontSize="6.5">SKU ที่จะสร้าง (auto)</text>
      <text x="14" y="44" fill="#1e293b" fontSize="8" fontFamily="monospace" fontWeight="600">LK-PRT-ENG-CBL-001</text>

      <rect x="200" y="22" width="192" height="28" rx="6" fill="#eff6ff" stroke="#93c5fd" strokeWidth="1.5" strokeDasharray="3 2" />
      <text x="206" y="32" fill="#3b82f6" fontSize="6.5" fontWeight="700">ATMS Code * (บังคับ ≥1 รหัส)</text>
      <rect x="206" y="34" width="36" height="10" rx="3" fill="#bfdbfe" />
      <text x="224" y="42" textAnchor="middle" fill="#1d4ed8" fontSize="6.5" fontFamily="monospace">AT-001 ×</text>
      <text x="246" y="42" fill="#94a3b8" fontSize="6.5">พิมพ์ + Enter</text>

      {/* Row 2: ชื่อ TH | ชื่อ EN */}
      <text x="8" y="60" fill="#64748b" fontSize="7">ชื่อ TH *</text>
      <rect x="9" y="63" width="27" height="10" rx="3" fill="rgba(239,68,68,0.1)" />
      <text x="22" y="71.5" textAnchor="middle" fill="#ef4444" fontSize="6.5">บังคับ</text>
      <rect x="8" y="64" width="186" height="19" rx="5" fill="white" stroke="#10b981" strokeWidth="1.5" />
      <text x="14" y="77" fill="#94a3b8" fontSize="7.5">กรองน้ำมันเครื่อง Isuzu...</text>

      <text x="200" y="60" fill="#64748b" fontSize="7">ชื่อ EN</text>
      <rect x="200" y="64" width="192" height="19" rx="5" fill="white" stroke="#e2e8f0" strokeWidth="0.8" />
      <text x="206" y="77" fill="#cbd5e1" fontSize="7.5">Engine Oil Filter (optional)</text>

      {/* Row 3: Part No | Position */}
      <text x="8" y="93" fill="#64748b" fontSize="7">เบอร์อะไหล่</text>
      <rect x="8" y="96" width="186" height="19" rx="5" fill="white" stroke="#e2e8f0" strokeWidth="0.8" />
      <text x="14" y="109" fill="#94a3b8" fontSize="7.5">8-97306044-0</text>

      <text x="200" y="93" fill="#64748b" fontSize="7">ตำแหน่ง</text>
      <rect x="200" y="96" width="192" height="19" rx="5" fill="white" stroke="#e2e8f0" strokeWidth="0.8" />
      <text x="206" y="109" fill="#94a3b8" fontSize="7.5">GN — General ▾</text>

      {/* Row 4: ราคา | หน่วย */}
      <text x="8" y="125" fill="#64748b" fontSize="7">ราคา/หน่วย (บาท)</text>
      <rect x="8" y="128" width="186" height="19" rx="5" fill="#fff7ed" stroke="#fdba74" strokeWidth="0.8" />
      <text x="14" y="141" fill="#9a3412" fontSize="7">0 (กรอกตอน transaction)</text>
      <text x="120" y="125" fill="#f97316" fontSize="6.5">← ล็อกอัตโนมัติ (LAB/SVC/CLN/TRP)</text>

      <text x="200" y="125" fill="#64748b" fontSize="7">หน่วย *</text>
      <rect x="200" y="128" width="192" height="19" rx="5" fill="white" stroke="#10b981" strokeWidth="1.5" />
      <text x="206" y="141" fill="#94a3b8" fontSize="7.5">PC — ชิ้น ▾</text>

      {/* Row 5: Brand | Grade */}
      <text x="8" y="157" fill="#64748b" fontSize="7">ยี่ห้อ (Brand)</text>
      <rect x="8" y="160" width="186" height="19" rx="5" fill="white" stroke="#e2e8f0" strokeWidth="0.8" />
      <text x="14" y="173" fill="#94a3b8" fontSize="7.5">พิมพ์เพื่อค้นหาหรือเพิ่มใหม่...</text>

      <text x="200" y="157" fill="#64748b" fontSize="7">Grade</text>
      <rect x="200" y="160" width="192" height="19" rx="5" fill="white" stroke="#e2e8f0" strokeWidth="0.8" />
      <text x="206" y="173" fill="#94a3b8" fontSize="7.5">OEM — อะไหล่แท้ ▾</text>

      {/* Row 6: OEM Ref | เบอร์เทียบ */}
      <text x="8" y="189" fill="#64748b" fontSize="7">OEM Ref (เบอร์แท้)</text>
      <rect x="8" y="192" width="186" height="19" rx="5" fill="white" stroke="#e2e8f0" strokeWidth="0.8" />
      <text x="14" y="205" fill="#94a3b8" fontSize="7.5">8-97306044-0</text>

      <text x="200" y="189" fill="#64748b" fontSize="7">เบอร์เทียบ (ใส่ได้หลายเบอร์)</text>
      <rect x="200" y="192" width="192" height="19" rx="5" fill="white" stroke="#e2e8f0" strokeWidth="0.8" />
      <rect x="206" y="196" width="34" height="10" rx="3" fill="#f1f5f9" />
      <text x="223" y="204" textAnchor="middle" fill="#475569" fontSize="6.5" fontFamily="monospace">SO-7660 ×</text>
      <text x="244" y="205" fill="#94a3b8" fontSize="7">+ Enter</text>

      {/* Row 7: Vehicles full width */}
      <text x="8" y="221" fill="#64748b" fontSize="7">ยานพาหนะที่ใช้ได้ (เลือกได้หลายคัน)</text>
      <rect x="8" y="224" width="384" height="19" rx="5" fill="white" stroke="#e2e8f0" strokeWidth="0.8" />
      <text x="14" y="237" fill="#94a3b8" fontSize="7.5">ค้นหาทะเบียน / ประเภทรถ / Fleet No...</text>

      <text x="200" y="255" textAnchor="middle" fill="#1e293b" fontSize="8" fontWeight="600">สีเขียว = บังคับ · สีส้ม = ล็อกอัตโนมัติ · ขาว = optional</text>
    </svg>
  )
}

function VisualSubmitFlow() {
  return (
    <svg viewBox="0 0 400 175" className="w-full rounded-xl" aria-label="Submit flow">
      <rect width="400" height="175" fill="#f8fafc" rx="10" />
      <text x="200" y="22" textAnchor="middle" fill="#64748b" fontSize="9">กรอกข้อมูลครบ → กด Submit</text>
      <rect x="140" y="28" width="120" height="28" rx="8" fill="#10b981" />
      <text x="200" y="46" textAnchor="middle" fill="white" fontSize="10" fontWeight="600">Submit SKU</text>
      <rect x="137" y="25" width="126" height="34" rx="10" fill="none" stroke="#10b981" strokeWidth="1.5" opacity="0.5" />
      <line x1="200" y1="58" x2="200" y2="70" stroke="#64748b" strokeWidth="1" />
      <line x1="100" y1="70" x2="300" y2="70" stroke="#64748b" strokeWidth="1" />
      <line x1="100" y1="70" x2="100" y2="82" stroke="#64748b" strokeWidth="1" />
      <line x1="300" y1="70" x2="300" y2="82" stroke="#64748b" strokeWidth="1" />
      <text x="100" y="79" textAnchor="middle" fill="#64748b" fontSize="8">ผู้ใช้ทั่วไป</text>
      <rect x="30" y="84" width="140" height="42" rx="8" fill="#fff7ed" stroke="#fed7aa" strokeWidth="1" />
      <text x="100" y="101" textAnchor="middle" fill="#c2410c" fontSize="9" fontWeight="600">⏳ รออนุมัติ</text>
      <text x="100" y="114" textAnchor="middle" fill="#9a3412" fontSize="7.5">Admin ต้องตรวจก่อน</text>
      <text x="100" y="125" textAnchor="middle" fill="#9a3412" fontSize="7">ดูสถานะที่ "รายการของฉัน"</text>
      <text x="300" y="79" textAnchor="middle" fill="#64748b" fontSize="8">Admin</text>
      <rect x="230" y="84" width="140" height="42" rx="8" fill="#f0fdf4" stroke="#86efac" strokeWidth="1" />
      <text x="300" y="101" textAnchor="middle" fill="#15803d" fontSize="9" fontWeight="600">✓ Approved ทันที</text>
      <text x="300" y="114" textAnchor="middle" fill="#166534" fontSize="7.5">เข้า SKU list ได้เลย</text>
      <text x="300" y="125" textAnchor="middle" fill="#166534" fontSize="7">ไม่ต้องรออนุมัติ</text>
      <text x="200" y="152" textAnchor="middle" fill="#94a3b8" fontSize="8">Admin เห็นทุก SKU ที่รออนุมัติใน sidebar หมวด Admin</text>
    </svg>
  )
}

function VisualMySubmissions() {
  return (
    <svg viewBox="0 0 400 175" className="w-full rounded-xl" aria-label="My submissions tabs">
      <rect width="400" height="175" fill="#f8fafc" rx="10" />
      <text x="12" y="22" fill="#1e293b" fontSize="11" fontWeight="700">รายการของฉัน</text>
      <rect x="8" y="28" width="185" height="26" rx="8" fill="white" stroke="#e2e8f0" strokeWidth="0.8" />
      <rect x="10" y="30" width="88" height="22" rx="6" fill="#f1f5f9" />
      <text x="54" y="45" textAnchor="middle" fill="#64748b" fontSize="8.5">รออนุมัติ (2)</text>
      <rect x="102" y="30" width="88" height="22" rx="6" fill="#fef2f2" stroke="#fca5a5" strokeWidth="1" />
      <text x="146" y="45" textAnchor="middle" fill="#dc2626" fontSize="8.5" fontWeight="600">ถูกปฏิเสธ (1)</text>
      <rect x="100" y="28" width="92" height="26" rx="8" fill="none" stroke="#10b981" strokeWidth="1.5" />
      <text x="252" y="42" fill="#10b981" fontSize="8" fontWeight="600">← เลือก tab นี้</text>
      <rect x="8" y="60" width="384" height="60" rx="8" fill="white" stroke="#fca5a5" strokeWidth="1" />
      <rect x="16" y="68" width="80" height="12" rx="3" fill="#e2e8f0" />
      <rect x="106" y="68" width="120" height="12" rx="3" fill="#e2e8f0" />
      <text x="16" y="96" fill="#ef4444" fontSize="8">เหตุผล: ชื่อซ้ำกับ SKU ที่มีอยู่แล้ว กรุณาแก้ไข</text>
      <rect x="306" y="64" width="78" height="26" rx="7" fill="#10b981" />
      <text x="345" y="81" textAnchor="middle" fill="white" fontSize="8.5" fontWeight="600">ส่งอีกครั้ง</text>
      <rect x="304" y="62" width="82" height="30" rx="9" fill="none" stroke="#10b981" strokeWidth="1.5" opacity="0.5" />
      <text x="200" y="138" textAnchor="middle" fill="#10b981" fontSize="8.5" fontWeight="500">↑ อ่านเหตุผล แก้ไขข้อมูล แล้วกด "ส่งอีกครั้ง"</text>
      <text x="200" y="152" textAnchor="middle" fill="#94a3b8" fontSize="7.5">ระบบจะส่ง SKU กลับไปคิวรออนุมัติใหม่</text>
    </svg>
  )
}

function VisualPartsTree() {
  return (
    <svg viewBox="0 0 400 185" className="w-full rounded-xl" aria-label="Parts catalog tree">
      <rect width="400" height="185" fill="#f8fafc" rx="10" />
      <text x="12" y="20" fill="#1e293b" fontSize="11" fontWeight="700">Parts Catalog</text>
      <rect x="8" y="26" width="384" height="22" rx="6" fill="white" stroke="#e2e8f0" strokeWidth="0.8" />
      <text x="24" y="40" fill="#94a3b8" fontSize="9">🔍 ค้นหา parts...</text>
      <rect x="8" y="54" width="384" height="24" rx="7" fill="#f0fdf4" stroke="#86efac" strokeWidth="1.5" />
      <text x="20" y="70" fill="#16a34a" fontSize="10">🔴</text>
      <text x="36" y="70" fill="#15803d" fontSize="9" fontWeight="700">ENG · Engine System</text>
      <text x="384" y="70" textAnchor="end" fill="#10b981" fontSize="10">▲</text>
      <rect x="24" y="80" width="368" height="20" rx="5" fill="#f0fdf4" stroke="#d1fae5" strokeWidth="0.8" />
      <text x="36" y="93" fill="#64748b" fontSize="8.5">  └ ENG-001 · Cylinder Block Assembly</text>
      <rect x="24" y="102" width="368" height="20" rx="5" fill="#f0fdf4" stroke="#d1fae5" strokeWidth="0.8" />
      <text x="36" y="115" fill="#64748b" fontSize="8.5">  └ ENG-002 · Crankshaft Assembly</text>
      <rect x="22" y="78" width="372" height="46" rx="7" fill="none" stroke="#10b981" strokeWidth="1.5" />
      <rect x="8" y="130" width="384" height="24" rx="7" fill="white" stroke="#e2e8f0" strokeWidth="0.6" />
      <text x="20" y="146" fill="#6366f1" fontSize="10">🔵</text>
      <text x="36" y="146" fill="#374151" fontSize="9">TRN · Transmission System</text>
      <text x="384" y="146" textAnchor="end" fill="#94a3b8" fontSize="10">▼</text>
      <text x="200" y="170" textAnchor="middle" fill="#10b981" fontSize="8.5" fontWeight="500">กด L1 เพื่อขยาย ดู L2 ย่อย และ L3 ภายใน</text>
    </svg>
  )
}

function VisualVehicleRow() {
  return (
    <svg viewBox="0 0 400 185" className="w-full rounded-xl" aria-label="Vehicle expanded row">
      <rect width="400" height="185" fill="#f8fafc" rx="10" />
      <text x="12" y="20" fill="#1e293b" fontSize="11" fontWeight="700">ยานพาหนะ</text>
      <rect x="8" y="26" width="240" height="22" rx="6" fill="white" stroke="#e2e8f0" strokeWidth="0.8" />
      <text x="24" y="40" fill="#94a3b8" fontSize="8.5">🔍 ทะเบียน / Fleet / Engine / Chassis...</text>
      <rect x="256" y="26" width="136" height="22" rx="6" fill="#10b981" />
      <text x="324" y="41" textAnchor="middle" fill="white" fontSize="8.5" fontWeight="600">+ เพิ่มยานพาหนะ</text>
      <rect x="8" y="54" width="384" height="22" fill="white" stroke="#e2e8f0" strokeWidth="0.4" />
      <text x="16" y="68" fill="#1e293b" fontSize="9" fontWeight="600">กค-1234</text>
      <rect x="60" y="58" width="45" height="14" rx="4" fill="#dbeafe" />
      <text x="82.5" y="68" textAnchor="middle" fill="#1d4ed8" fontSize="7.5">Mixer</text>
      <text x="115" y="68" fill="#64748b" fontSize="8">รถผสมคอนกรีต ทะเบียน กค-1234</text>
      <text x="384" y="69" textAnchor="end" fill="#94a3b8" fontSize="8.5">▼</text>
      <rect x="8" y="76" width="384" height="66" rx="0" fill="#f0fdf4" stroke="#86efac" strokeWidth="1.5" />
      <text x="16" y="91" fill="#15803d" fontSize="9" fontWeight="700">ขข-5678 · รายละเอียด</text>
      <rect x="65" y="80" width="50" height="14" rx="4" fill="#fef3c7" />
      <text x="90" y="90" textAnchor="middle" fill="#92400e" fontSize="7.5">Trailer</text>
      <text x="16" y="108" fill="#64748b" fontSize="8.5">Engine No:</text>
      <text x="75" y="108" fill="#1e293b" fontSize="8.5" fontWeight="500">1HD-FT-123456</text>
      <text x="16" y="124" fill="#64748b" fontSize="8.5">Chassis No:</text>
      <text x="75" y="124" fill="#1e293b" fontSize="8.5" fontWeight="500">MBL456-789012</text>
      <text x="220" y="108" fill="#64748b" fontSize="8.5">Fleet No:</text>
      <text x="265" y="108" fill="#1e293b" fontSize="8.5" fontWeight="500">FL-0023</text>
      <text x="220" y="124" fill="#64748b" fontSize="8.5">Type:</text>
      <text x="245" y="124" fill="#1e293b" fontSize="8.5" fontWeight="500">Semi-trailer</text>
      <rect x="6" y="74" width="388" height="70" rx="9" fill="none" stroke="#10b981" strokeWidth="2" />
      <text x="200" y="158" textAnchor="middle" fill="#10b981" fontSize="8.5" fontWeight="500">↑ กดที่แถวเพื่อขยาย ดู Engine / Chassis / Fleet No</text>
      <text x="200" y="171" textAnchor="middle" fill="#94a3b8" fontSize="7.5">กดปุ่ม Edit ที่ขวาสุดเพื่อแก้ไขข้อมูล</text>
    </svg>
  )
}

function VisualAdminApprove() {
  return (
    <svg viewBox="0 0 400 185" className="w-full rounded-xl" aria-label="Admin approve reject">
      <rect width="400" height="185" fill="#f8fafc" rx="10" />
      <text x="12" y="20" fill="#1e293b" fontSize="11" fontWeight="700">รออนุมัติ SKU</text>
      <rect y="24" width="400" height="0.8" fill="#e2e8f0" />
      <rect x="8" y="30" width="384" height="64" rx="8" fill="white" stroke="#e2e8f0" strokeWidth="0.8" />
      <rect x="16" y="38" width="100" height="13" rx="4" fill="rgba(16,185,129,0.12)" />
      <text x="66" y="48.5" textAnchor="middle" fill="#10b981" fontSize="8.5" fontWeight="700">BKK-WS-ENG-001</text>
      <rect x="126" y="38" width="130" height="13" rx="3" fill="#e2e8f0" />
      <text x="16" y="64" fill="#94a3b8" fontSize="7.5">โดย: สมชาย ใจดี · 10 นาทีที่แล้ว</text>
      <rect x="16" y="70" width="100" height="14" rx="4" fill="#fef3c7" stroke="#fcd34d" strokeWidth="0.8" />
      <text x="66" y="80" textAnchor="middle" fill="#92400e" fontSize="7.5">⚠ พบ SKU คล้ายกัน 2 รายการ</text>
      <rect x="308" y="38" width="32" height="28" rx="8" fill="#10b981" />
      <text x="324" y="56" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold">✓</text>
      <rect x="306" y="36" width="36" height="32" rx="10" fill="none" stroke="#10b981" strokeWidth="1.5" opacity="0.5" />
      <rect x="346" y="38" width="32" height="28" rx="8" fill="#fee2e2" stroke="#fca5a5" strokeWidth="0.8" />
      <text x="362" y="56" textAnchor="middle" fill="#dc2626" fontSize="14" fontWeight="bold">✕</text>
      <rect x="344" y="36" width="36" height="32" rx="10" fill="none" stroke="#ef4444" strokeWidth="1.5" opacity="0.5" />
      <line x1="324" y1="70" x2="324" y2="80" stroke="#10b981" strokeWidth="1.5" />
      <text x="324" y="90" textAnchor="middle" fill="#10b981" fontSize="8" fontWeight="600">อนุมัติ</text>
      <line x1="362" y1="70" x2="362" y2="80" stroke="#ef4444" strokeWidth="1.5" />
      <text x="362" y="90" textAnchor="middle" fill="#ef4444" fontSize="8" fontWeight="600">ปฏิเสธ</text>
      <rect x="60" y="98" width="280" height="72" rx="10" fill="white" stroke="#e2e8f0" strokeWidth="0.8" />
      <text x="200" y="114" textAnchor="middle" fill="#1e293b" fontSize="9" fontWeight="600">popup: ระบุเหตุผลการปฏิเสธ</text>
      <rect x="74" y="120" width="252" height="22" rx="6" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="0.8" />
      <text x="110" y="134.5" fill="#94a3b8" fontSize="8">ชื่อซ้ำกับ SKU BKK-WS-ENG-...</text>
      <rect x="74" y="148" width="252" height="0.5" fill="#e2e8f0" />
      <rect x="282" y="152" width="40" height="14" rx="5" fill="#ef4444" />
      <text x="302" y="162" textAnchor="middle" fill="white" fontSize="7.5" fontWeight="600">ปฏิเสธ</text>
      <text x="200" y="179" textAnchor="middle" fill="#94a3b8" fontSize="7.5">เหตุผลจะส่งถึงผู้สร้างใน "รายการของฉัน" ทันที</text>
    </svg>
  )
}

// ── Visual Lookup Map ────────────────────────────────────────────────

const VISUALS: Record<string, React.ReactNode> = {
  "login-1":            <VisualLoginGoogle />,
  "sku-list-1":         <VisualSKUFilter />,
  "sku-list-3":         <VisualSKURow />,
  "sku-new-1":          <VisualCascadeDropdown />,
  "sku-new-2":          <VisualFormFields />,
  "sku-new-4":          <VisualSubmitFlow />,
  "my-submissions-2":   <VisualMySubmissions />,
  "parts-1":            <VisualPartsTree />,
  "vehicles-2":         <VisualVehicleRow />,
  "admin-2":            <VisualAdminApprove />,
  "admin-3":            <VisualAdminApprove />,
}

// ── Data ─────────────────────────────────────────────────────────────

type Step = { title: string; desc: string }
type Section = { id: string; icon: React.ElementType; title: string; badge?: string; steps: Step[] }

const SECTIONS: Section[] = [
  {
    id: "login",
    icon: LogIn,
    title: "เข้าสู่ระบบ",
    steps: [
      { title: "เปิดเบราว์เซอร์", desc: "ไปที่ URL ของระบบ Mena WMS" },
      { title: "กด Sign in with Google", desc: "คลิกปุ่มสีขาว Google ที่หน้า Login" },
      { title: "เลือกบัญชีบริษัท", desc: "ต้องใช้อีเมล @menatransport.co.th เท่านั้น บัญชีอื่นจะไม่ผ่าน" },
      { title: "เข้าระบบสำเร็จ", desc: "ระบบพาไปหน้า Dashboard โดยอัตโนมัติ" },
    ],
  },
  {
    id: "dashboard",
    icon: LayoutDashboard,
    title: "Dashboard",
    steps: [
      { title: "ภาพรวม", desc: "หน้าแรกแสดง stat ทั่วไป — จำนวน SKU ทั้งหมดและ breakdown ตามประเภท" },
      { title: "Quick Link", desc: "กดปุ่ม shortcut เพื่อไปยัง SKU List, เพิ่ม SKU, Parts Catalog หรือ Stats ได้ทันที" },
      { title: "Sidebar", desc: "ใช้เมนูซ้ายมือในการนำทางระหว่าง feature ต่าง ๆ กดลูกศรเพื่อย่อ/ขยาย sidebar" },
    ],
  },
  {
    id: "sku-list",
    icon: PackageSearch,
    title: "รายการ SKU",
    steps: [
      { title: "เปิดรายการ", desc: "กด \"รายการ SKU\" ใน sidebar หมวด Master SKU" },
      { title: "กรองข้อมูล", desc: "ใช้ filter bar ด้านบน — กรองตาม Warehouse, ประเภท, L1 → L2 → L3, Brand, Grade หรือยานพาหนะ (dropdown จะ cascade อัตโนมัติ)" },
      { title: "ค้นหา", desc: "พิมพ์ในช่อง Search เพื่อค้นหาตามชื่อ SKU หรือ code" },
      { title: "เปิดรายละเอียด", desc: "กดที่แถวใดก็ได้เพื่อดู หรือแก้ไขรายละเอียด SKU นั้น" },
      { title: "แก้ไข SKU", desc: "ในหน้า Edit — ชื่อ, ราคา, Brand, ยานพาหนะแก้ไขได้ ส่วน Warehouse/Type/L1-L2-L3 จะล็อกไว้" },
    ],
  },
  {
    id: "sku-new",
    icon: PlusCircle,
    title: "เพิ่ม SKU ใหม่",
    steps: [
      { title: "เปิดฟอร์ม", desc: "กด \"เพิ่ม SKU ใหม่\" ใน sidebar" },
      { title: "เลือก Category", desc: "เลือก Warehouse → Expense Type → L1 → L2 → L3 ตามลำดับ (dropdown จะ filter อัตโนมัติ)" },
      { title: "กรอกรายละเอียด", desc: "ชื่อ TH (บังคับ, label เปลี่ยนตาม Type) / EN, ATMS Code ≥1 รหัส (พิมพ์ + Enter), เบอร์อะไหล่, ตำแหน่ง, ราคา/หน่วย (ราคาล็อกอัตโนมัติสำหรับ LAB/SVC/CLN/TRP), Brand, Grade, OEM Ref และเบอร์เทียบ" },
      { title: "เลือกยานพาหนะ", desc: "เลือกยานพาหนะที่ใช้ได้กับ SKU นี้ — เลือกได้มากกว่า 1 คัน" },
      { title: "ส่งข้อมูล", desc: "กด Submit — ผู้ใช้ทั่วไปจะเข้าคิวรออนุมัติ, Admin จะ approved ทันที" },
    ],
  },
  {
    id: "my-submissions",
    icon: Inbox,
    title: "รายการของฉัน",
    steps: [
      { title: "เปิดหน้า", desc: "กด \"รายการของฉัน\" ใน sidebar หมวด Master SKU" },
      { title: "แท็บ รออนุมัติ", desc: "ดู SKU ที่ส่งไปแล้วและยังรอ Admin ตรวจสอบอยู่" },
      { title: "แท็บ ถูกปฏิเสธ", desc: "ดู SKU ที่ Admin ปฏิเสธพร้อมเหตุผลที่แจ้งมา" },
      { title: "ส่งใหม่", desc: "กด \"ส่งอีกครั้ง\" เพื่อแก้ไขข้อมูลและส่ง SKU ที่ถูกปฏิเสธกลับไปอนุมัติใหม่" },
    ],
  },
  {
    id: "parts",
    icon: Layers,
    title: "Parts Catalog",
    steps: [
      { title: "เปิด Catalog", desc: "กด \"Parts Catalog\" ใน sidebar หมวด Reference" },
      { title: "ดูโครงสร้าง", desc: "Tree view แสดง L1 (ระบบหลัก) → L2 (Sub-assembly) → L3 (Component)" },
      { title: "ค้นหา", desc: "พิมพ์ใน search bar เพื่อกรองและ highlight รายการที่ตรง" },
      { title: "ขยาย / ย่อ", desc: "กดที่ L1 เพื่อขยายดู L2 และ L3 ภายใน" },
    ],
  },
  {
    id: "vehicles",
    icon: Car,
    title: "ยานพาหนะ",
    steps: [
      { title: "เปิดรายการ", desc: "กด \"ยานพาหนะ\" ใน sidebar หมวด Reference" },
      { title: "ค้นหา", desc: "ค้นหาได้ด้วยทะเบียน, Fleet No, Engine No หรือ Chassis No" },
      { title: "ดูรายละเอียด", desc: "กดที่แถวเพื่อขยายข้อมูล — Engine No, Chassis No, ประเภทยานพาหนะ" },
      { title: "เพิ่ม / แก้ไข", desc: "กดปุ่ม + เพื่อเพิ่มยานพาหนะใหม่ หรือกด Edit ในแถวเพื่อแก้ไขข้อมูล" },
    ],
  },
  {
    id: "codes",
    icon: Database,
    title: "Code Dictionary",
    steps: [
      { title: "เปิดหน้า", desc: "กด \"Code Dictionary\" ใน sidebar หมวด Reference" },
      { title: "เลือกประเภท", desc: "กดการ์ดที่ต้องการ เช่น BRAND, GRADE, WAREHOUSE เพื่อเข้าจัดการ" },
      { title: "เพิ่ม Code", desc: "กด + Add เพื่อเพิ่ม code ใหม่ในประเภทนั้น" },
      { title: "แก้ไข / ลบ", desc: "กด Edit หรือ Delete ในแต่ละแถวเพื่อแก้ไขหรือลบ code ออก" },
    ],
  },
  {
    id: "admin",
    icon: Clock,
    title: "อนุมัติ SKU",
    badge: "Admin",
    steps: [
      { title: "เข้าหน้ารออนุมัติ", desc: "กด \"รออนุมัติ SKU\" ใน sidebar หมวด Admin — เห็นเฉพาะผู้ใช้ที่มีสิทธิ์ Admin เท่านั้น" },
      { title: "ตรวจสอบ SKU ซ้ำ", desc: "ระบบแสดง SKU ที่คล้ายกันในหมวดเดียวกันโดยอัตโนมัติเพื่อช่วยตัดสินใจ" },
      { title: "อนุมัติ", desc: "กด ✓ เพื่ออนุมัติ SKU เข้าระบบทันที" },
      { title: "ปฏิเสธ", desc: "กด ✕ พร้อมใส่เหตุผล — ผู้สร้างจะเห็นเหตุผลในหน้า \"รายการของฉัน\" และส่งใหม่ได้" },
    ],
  },
]

// ── Main Component ───────────────────────────────────────────────────

export function ManualBook({ collapsed }: { collapsed?: boolean }) {
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState("login")
  const [openVisuals, setOpenVisuals] = useState<Set<string>>(new Set())
  const contentRef = useRef<HTMLDivElement>(null)

  function scrollTo(id: string) {
    setActiveId(id)
    const el = document.getElementById(`manual-${id}`)
    if (el && contentRef.current) {
      contentRef.current.scrollTo({ top: el.offsetTop - 20, behavior: "smooth" })
    }
  }

  function toggleVisual(key: string) {
    setOpenVisuals(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  useEffect(() => {
    if (!open) return
    const container = contentRef.current
    if (!container) return
    function onScroll() {
      for (let i = SECTIONS.length - 1; i >= 0; i--) {
        const el = document.getElementById(`manual-${SECTIONS[i].id}`)
        if (el && el.offsetTop - 40 <= (container?.scrollTop ?? 0)) {
          setActiveId(SECTIONS[i].id)
          break
        }
      }
    }
    container.addEventListener("scroll", onScroll, { passive: true })
    return () => container.removeEventListener("scroll", onScroll)
  }, [open])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false) }
    if (open) window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  return (
    <>
      <button
        onClick={() => { setOpen(true); setActiveId("login"); setOpenVisuals(new Set()) }}
        title="คู่มือการใช้งาน"
        className={`flex w-full items-center gap-2.5 rounded-lg py-2 text-[13px] font-medium transition-all duration-150 text-[#64748B] dark:text-gray-500 hover:bg-[#F4FBF5] dark:hover:bg-white/6 hover:text-[#0F6A3C] dark:hover:text-gray-300 ${collapsed ? "justify-center px-0" : "px-2.5"}`}
      >
        <BookOpen size={14} className="shrink-0" />
        {!collapsed && <span>คู่มือการใช้งาน</span>}
      </button>

      {open && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />

          <div
            className="relative z-10 flex w-full max-w-3xl rounded-2xl overflow-hidden shadow-2xl border border-[#E2E8F0] dark:border-white/8"
            style={{ height: "min(88vh, 700px)" }}
          >
            {/* ── Left nav ── */}
            <div className="w-52 shrink-0 flex flex-col border-r border-[#E2E8F0] dark:border-white/5 bg-[#F8FFFE] dark:bg-[#0a0e14]">
              <div className="px-3.5 pt-4 pb-3 border-b border-[#E2E8F0] dark:border-white/5">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-[#0F6A3C] to-[#1B8C4B]">
                    <BookOpen size={13} className="text-white" />
                  </div>
                  <div>
                    <p className="text-[13px] font-bold text-[#1E293B] dark:text-white leading-none">คู่มือ</p>
                    <p className="text-[10px] text-[#94A3B8] dark:text-gray-500 mt-0.5">Mena WMS · ฉบับย่อ</p>
                  </div>
                </div>
              </div>

              <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
                {SECTIONS.map((s) => {
                  const Icon = s.icon
                  const active = activeId === s.id
                  return (
                    <button
                      key={s.id}
                      onClick={() => scrollTo(s.id)}
                      className={`w-full flex items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-all duration-150 ${
                        active
                          ? "bg-[#1B8C4B] text-white shadow-sm shadow-[#1B8C4B]/20"
                          : "text-[#64748B] dark:text-gray-400 hover:bg-[#F4FBF5] dark:hover:bg-white/5 hover:text-[#0F6A3C] dark:hover:text-white"
                      }`}
                    >
                      <Icon size={13} className="shrink-0" />
                      <span className="flex-1 text-[12px] font-medium truncate">{s.title}</span>
                      {s.badge && (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                          active ? "bg-white/20 text-white" : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                        }`}>{s.badge}</span>
                      )}
                    </button>
                  )
                })}
              </nav>
            </div>

            {/* ── Right content ── */}
            <div className="flex flex-col flex-1 min-w-0 bg-white dark:bg-[#0d1117]">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#E2E8F0] dark:border-white/5 shrink-0">
                <div>
                  <h2 className="text-[15px] font-bold text-[#1E293B] dark:text-white leading-none">คู่มือการใช้งาน Mena WMS</h2>
                  <p className="text-[11px] text-[#94A3B8] dark:text-gray-500 mt-1">กดที่ชื่อ step เพื่อดูตัวอย่างภาพประกอบ</p>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#94A3B8] hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/20 dark:hover:text-red-400 transition-colors"
                >
                  <X size={15} />
                </button>
              </div>

              <div ref={contentRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-7">
                {SECTIONS.map((section, si) => {
                  const Icon = section.icon
                  return (
                    <div key={section.id} id={`manual-${section.id}`}>
                      <div className="flex items-center gap-3 mb-3.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#0F6A3C]/10 dark:bg-[#1B8C4B]/15">
                          <Icon size={15} className="text-[#0F6A3C] dark:text-[#4CAF50]" />
                        </div>
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <h3 className="text-[14px] font-bold text-[#1E293B] dark:text-white">{section.title}</h3>
                          {section.badge && (
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 shrink-0">
                              {section.badge}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2 ml-11">
                        {section.steps.map((step, i) => {
                          const vKey = `${section.id}-${i}`
                          const hasVisual = vKey in VISUALS
                          const visualOpen = openVisuals.has(vKey)
                          return (
                            <div key={i}>
                              <div className="flex gap-3 items-start">
                                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0F6A3C] text-white text-[9px] font-black mt-0.5">
                                  {i + 1}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <button
                                    onClick={() => hasVisual && toggleVisual(vKey)}
                                    className={`flex items-center gap-1.5 text-left w-full group ${hasVisual ? "cursor-pointer" : "cursor-default"}`}
                                  >
                                    <p className={`text-[12px] font-semibold leading-snug transition-colors ${
                                      hasVisual
                                        ? "text-[#0F6A3C] dark:text-[#4CAF50] group-hover:text-[#0a5430] dark:group-hover:text-emerald-300"
                                        : "text-[#1E293B] dark:text-gray-200"
                                    }`}>
                                      {step.title}
                                    </p>
                                    {hasVisual && (
                                      <span className={`shrink-0 flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-md transition-colors ${
                                        visualOpen
                                          ? "bg-[#0F6A3C]/15 text-[#0F6A3C] dark:bg-emerald-900/30 dark:text-emerald-400"
                                          : "bg-[#E2E8F0] dark:bg-white/8 text-[#64748B] dark:text-gray-400 group-hover:bg-[#0F6A3C]/10 group-hover:text-[#0F6A3C] dark:group-hover:bg-emerald-900/20 dark:group-hover:text-emerald-400"
                                      }`}>
                                        {visualOpen
                                          ? <><EyeOff size={9} /> ซ่อน</>
                                          : <><Eye size={9} /> ดูภาพ</>
                                        }
                                      </span>
                                    )}
                                  </button>
                                  <p className="text-[11px] text-[#64748B] dark:text-gray-400 leading-relaxed mt-0.5">{step.desc}</p>

                                  {hasVisual && visualOpen && (
                                    <div className="mt-2.5 rounded-xl overflow-hidden border border-[#E2E8F0] dark:border-white/8 bg-[#F8FAFC] dark:bg-white/3 p-2">
                                      {VISUALS[vKey]}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      {si < SECTIONS.length - 1 && (
                        <div className="mt-6 h-px bg-[#F1F5F9] dark:bg-white/5" />
                      )}
                    </div>
                  )
                })}

                <div className="pt-2 pb-4 text-center">
                  <p className="text-[10px] text-[#CBD5E1] dark:text-gray-600">Mena WMS · Warehouse Management System</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
