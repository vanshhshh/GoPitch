import { MarketingNav } from "@/components/MarketingNav";
import { MarketingFooter } from "@/components/MarketingFooter";

export default function TermsPage() {
  return (
    <div className="min-h-screen">
      <MarketingNav />
      <main className="max-w-2xl mx-auto px-6 py-20">
        <h1 className="font-display text-4xl mb-2">Terms of Service</h1>
        <p className="text-ink-soft text-sm mb-10">Last updated: August 2026</p>

        <div className="space-y-8 text-sm leading-relaxed text-ink-soft">
          <section>
            <h2 className="font-display text-lg text-ink mb-2">No guarantee of outcomes</h2>
            <p>
              Pitch-OS provides deck generation, investor matching, and outreach tooling. We do
              not guarantee investor replies, meetings, or funding outcomes. Matching scores
              reflect available data and are not investment advice or a representation of any
              investor's actual intent.
            </p>
          </section>
          <section>
            <h2 className="font-display text-lg text-ink mb-2">Your responsibility for sending</h2>
            <p>
              When you connect Gmail and dispatch a campaign, you are sending email from your own
              account under your own authority. You are responsible for the accuracy and legality
              of content you send, including compliance with applicable anti-spam laws (e.g.
              CAN-SPAM, India's IT Act) in your jurisdiction.
            </p>
          </section>
          <section>
            <h2 className="font-display text-lg text-ink mb-2">Rate limits exist for your protection</h2>
            <p>
              Sending is rate-limited and subject to automatic pauses on bounce or spam-complaint
              signals. This is designed to protect your Gmail account's standing and is not
              configurable below the platform's safety floor.
            </p>
          </section>
          <section>
            <h2 className="font-display text-lg text-ink mb-2">Payment terms</h2>
            <p>
              Starter tier is a one-time charge. Growth and Enterprise tiers are billed monthly
              and can be cancelled at any time; cancellation takes effect at the end of the
              current billing period.
            </p>
          </section>
          <section>
            <h2 className="font-display text-lg text-ink mb-2">Account termination</h2>
            <p>
              We may suspend accounts that violate anti-spam laws, misuse the investor database,
              or attempt to circumvent sending safety limits.
            </p>
          </section>
          <section>
            <h2 className="font-display text-lg text-ink mb-2">Contact</h2>
            <p>Questions about these terms: use the contact page.</p>
          </section>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
