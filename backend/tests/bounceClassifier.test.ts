import { describe, it, expect } from "vitest";
import { classifyInboundMessage, extractBouncedRecipient } from "../src/lib/bounceClassifier";

describe("classifyInboundMessage", () => {
  it("classifies a standard mailer-daemon 'user unknown' bounce as a hard bounce", () => {
    const result = classifyInboundMessage({
      fromAddress: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
      subject: "Delivery Status Notification (Failure)",
      snippet: "Address not found. Your message wasn't delivered because the address couldn't be found.",
      headers: {},
    });
    expect(result).toBe("hard_bounce");
  });

  it("classifies a mailbox-full notice as a soft bounce", () => {
    const result = classifyInboundMessage({
      fromAddress: "postmaster@example.com",
      subject: "Undeliverable",
      snippet: "The recipient's mailbox is full and cannot accept messages at this time.",
      headers: {},
    });
    expect(result).toBe("soft_bounce");
  });

  it("classifies an unrecognized mailer-daemon message conservatively as a soft bounce", () => {
    const result = classifyInboundMessage({
      fromAddress: "mailer-daemon@example.com",
      subject: "Delivery Notification",
      snippet: "Something happened that doesn't match a known pattern.",
      headers: {},
    });
    expect(result).toBe("soft_bounce");
  });

  it("classifies a spam feedback-loop header as a complaint even without matching text", () => {
    const result = classifyInboundMessage({
      fromAddress: "feedback@isp.example.com",
      subject: "FBL Report",
      snippet: "A user marked your message as junk.",
      headers: { "Feedback-ID": "abc123" },
    });
    expect(result).toBe("complaint");
  });

  it("classifies explicit 'marked as spam' language as a complaint", () => {
    const result = classifyInboundMessage({
      fromAddress: "someone@example.com",
      subject: "Your message was marked as spam",
      snippet: "This message was flagged.",
      headers: {},
    });
    expect(result).toBe("complaint");
  });

  it("prioritizes complaint classification over bounce when both signals are present", () => {
    const result = classifyInboundMessage({
      fromAddress: "mailer-daemon@example.com",
      subject: "Delivery failed — marked as spam",
      snippet: "address not found",
      headers: {},
    });
    expect(result).toBe("complaint");
  });

  it("returns none for an ordinary reply from a real investor", () => {
    const result = classifyInboundMessage({
      fromAddress: "rishen@peakxv.example.com",
      subject: "Re: Velo Pay — Cross-border payments infra",
      snippet: "Thanks for reaching out, happy to take a look at the deck.",
      headers: {},
    });
    expect(result).toBe("none");
  });

  it("does not misclassify a legitimate email merely mentioning 'unavailable'", () => {
    const result = classifyInboundMessage({
      fromAddress: "rishen@peakxv.example.com",
      subject: "Re: intro",
      snippet: "I'm unavailable next week but let's connect after.",
      headers: {},
    });
    expect(result).toBe("none");
  });
});

describe("extractBouncedRecipient", () => {
  it("extracts the recipient from RFC 3464 Final-Recipient format", () => {
    const body = "Final-Recipient: rfc822; nonexistent@example.com\nAction: failed\nStatus: 5.1.1";
    expect(extractBouncedRecipient(body)).toBe("nonexistent@example.com");
  });

  it("falls back to a generic 'To:' style match when RFC 3464 format is absent", () => {
    const body = "Delivery to: broken@example.com failed permanently.";
    expect(extractBouncedRecipient(body)).toBe("broken@example.com");
  });

  it("returns null when no email address can be found", () => {
    const body = "Your message could not be delivered for unknown reasons.";
    expect(extractBouncedRecipient(body)).toBeNull();
  });

  it("normalizes extracted email to lowercase", () => {
    const body = "Final-Recipient: rfc822; Broken@Example.COM";
    expect(extractBouncedRecipient(body)).toBe("broken@example.com");
  });
});
