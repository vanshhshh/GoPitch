import { MarketingNav } from "@/components/MarketingNav";
import { MarketingFooter } from "@/components/MarketingFooter";

export default function AboutPage() {
  return (
    <div className="min-h-screen">
      <MarketingNav />
      <main className="max-w-2xl mx-auto px-6 py-20">
        <h1 className="font-display text-4xl mb-6">About GoPitch</h1>
        <div className="space-y-4 text-ink-soft leading-relaxed">
          <p>
            GoPitch started from a simple observation: the manual work of raising — researching
            investors, checking thesis fit, personalizing outreach, tracking replies — is the same
            grind every founder repeats from scratch, alone.
          </p>
          <p>
            We built the matching and drafting logic first, and tested it against real data before
            building anything else — including this website. If an investor in our database doesn't
            have real stage, sector, or geography information, we exclude them from matching rather
            than guess. That's a deliberate choice, not a limitation we're hiding.
          </p>
          <p>
            We're a small team building this in public, one honest decision at a time.
          </p>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
