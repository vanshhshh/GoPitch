import { MarketingNav } from "@/components/MarketingNav";
import { MarketingFooter } from "@/components/MarketingFooter";

export default function BlogPage() {
  return (
    <div className="min-h-screen">
      <MarketingNav />
      <main className="max-w-2xl mx-auto px-6 py-20 text-center">
        <h1 className="font-display text-4xl mb-4">Blog</h1>
        <p className="text-ink-soft">
          Nothing published yet — we're writing about what we learn from real raises, not
          publishing placeholder content to fill this page. Check back soon.
        </p>
      </main>
      <MarketingFooter />
    </div>
  );
}
