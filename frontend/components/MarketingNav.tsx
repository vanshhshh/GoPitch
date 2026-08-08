"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";

const LINKS = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
  { href: "/blog", label: "Blog" },
];

export function MarketingNav() {
  const [open, setOpen] = useState(false);

  return (
    <motion.nav
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="sticky top-0 z-50 bg-paper/85 backdrop-blur border-b border-line"
    >
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="font-display text-xl tracking-tight">
          Pitch-OS
        </Link>

        <div className="hidden md:flex items-center gap-8 text-sm">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="text-ink-soft hover:text-ink transition-colors">
              {l.label}
            </Link>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-3">
          <Link href="/login" className="text-sm text-ink-soft hover:text-ink transition-colors">
            Sign in
          </Link>
          <Link href="/signup" className="btn-primary text-sm">
            Start free
          </Link>
        </div>

        <button className="md:hidden" onClick={() => setOpen(!open)} aria-label="Toggle menu">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {open ? <path d="M18 6L6 18M6 6l12 12" /> : <path d="M3 6h18M3 12h18M3 18h18" />}
          </svg>
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-line bg-white px-6 py-4 space-y-3">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="block text-sm text-ink-soft" onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
          <div className="flex gap-3 pt-2">
            <Link href="/login" className="btn-secondary flex-1 text-center">
              Sign in
            </Link>
            <Link href="/signup" className="btn-primary flex-1 text-center">
              Start free
            </Link>
          </div>
        </div>
      )}
    </motion.nav>
  );
}
