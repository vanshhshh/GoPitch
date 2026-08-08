import { MarketingNav } from "@/components/MarketingNav";
import { MarketingFooter } from "@/components/MarketingFooter";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen">
      <MarketingNav />
      <main className="max-w-2xl mx-auto px-6 py-20 prose-sm">
        <h1 className="font-display text-4xl mb-2">Privacy Policy</h1>
        <p className="text-ink-soft text-sm mb-10">Last updated: August 2026</p>

        <div className="space-y-8 text-sm leading-relaxed text-ink-soft">
          <section>
            <h2 className="font-display text-lg text-ink mb-2">What we collect</h2>
            <p>
              Account information (name, email), company and deck information you provide to
              generate matches and outreach, and — if you connect Gmail — an encrypted OAuth
              refresh token used solely to send emails on your explicit instruction. We never
              read your inbox contents beyond what's needed to detect bounces and spam complaints
              on emails you sent through this platform.
            </p>
          </section>
          <section>
            <h2 className="font-display text-lg text-ink mb-2">What we don't do</h2>
            <p>
              We don't sell your data. We don't use your deck or company information to train
              models beyond generating your own deck and outreach content. We don't send email on
              your behalf without your explicit dispatch action.
            </p>
          </section>
          <section>
            <h2 className="font-display text-lg text-ink mb-2">Investor data</h2>
            <p>
              Investor contact records are sourced from public and licensed data sources.
              Investors without verified stage/sector/geography information are excluded from
              matching until enriched. If you are an investor and want a record corrected or
              removed, contact us.
            </p>
          </section>
          <section>
            <h2 className="font-display text-lg text-ink mb-2">Data retention</h2>
            <p>
              Account and campaign data is retained while your account is active. You may request
              deletion at any time by contacting support.
            </p>
          </section>
          <section>
            <h2 className="font-display text-lg text-ink mb-2">Security</h2>
            <p>
              Passwords are hashed (bcrypt), OAuth refresh tokens are encrypted at rest
              (AES-256-GCM), and all traffic is served over TLS in production.
            </p>
          </section>
          <section>
            <h2 className="font-display text-lg text-ink mb-2">Contact</h2>
            <p>Questions about this policy: use the contact page.</p>
          </section>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
