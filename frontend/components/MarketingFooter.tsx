import Link from "next/link";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/features", label: "Features" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/blog", label: "Blog" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="border-t border-line bg-white">
      <div className="max-w-6xl mx-auto px-6 py-12 grid grid-cols-2 md:grid-cols-4 gap-8">
        <div className="col-span-2 md:col-span-1">
          <p className="font-display text-lg mb-2">Pitch-OS</p>
          <p className="text-sm text-ink-soft">Deck, matched investors, and outreach — one flow.</p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <p className="label mb-3">{col.title}</p>
            <div className="space-y-2">
              {col.links.map((l) => (
                <Link key={l.href} href={l.href} className="block text-sm text-ink-soft hover:text-ink transition-colors">
                  {l.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-line-soft">
        <div className="max-w-6xl mx-auto px-6 py-4 text-xs text-ink-soft">
          © {new Date().getFullYear()} Pitch-OS. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
