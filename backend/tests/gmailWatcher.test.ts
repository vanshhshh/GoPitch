import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkGmailRepliesForUser, checkGmailRepliesForAllUsers } from "../src/services/gmailWatcher";

vi.mock("../src/lib/db", () => ({
  pool: {
    query: vi.fn(),
  },
}));

vi.mock("../src/routes/googleAuth", () => ({
  getGmailClientForUser: vi.fn(),
  userHasGmailModifyScope: vi.fn(),
}));

import { pool } from "../src/lib/db";
import { getGmailClientForUser, userHasGmailModifyScope } from "../src/routes/googleAuth";

const mockPoolQuery = vi.mocked(pool.query);
const mockGetGmailClientForUser = vi.mocked(getGmailClientForUser);
const mockUserHasGmailModifyScope = vi.mocked(userHasGmailModifyScope);

function setupMocks(returns: any[]) {
  vi.clearAllMocks();
  mockUserHasGmailModifyScope.mockReturnValue(true);
  for (const r of returns) {
    mockPoolQuery.mockResolvedValueOnce(r);
  }
}

describe("checkGmailRepliesForUser", () => {
  it("returns early when user has no Gmail connection", async () => {
    setupMocks([{ rows: [] }]);
    const result = await checkGmailRepliesForUser("user-1");
    expect(result.processed).toBe(0);
    expect(result.replied).toBe(0);
  });

  it("returns early when user lacks gmail.modify scope", async () => {
    mockUserHasGmailModifyScope.mockReturnValue(false);
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ google_refresh_token: "encrypted" }] } as any);
    const result = await checkGmailRepliesForUser("user-1");
    expect(result.errors).toContain("Insufficient Gmail scope — user needs to reconnect with gmail.modify.");
  });

  it("marks outreach as REPLIED when thread has inbound reply", async () => {
    const userRow = {
      id: "user-1",
      google_refresh_token: "encrypted",
      connected_gmail_address: "founder@example.com",
      email: "founder@example.com",
    };
    const sendRow = {
      id: "send-1",
      gmail_thread_id: "thread-1",
      investor_email: "investor@example.com",
      status: "SENT",
      sent_at: new Date(),
      investor_id: "inv-1",
    };

    setupMocks([
      { rows: [userRow] },
      { rows: [sendRow] },
      { rows: [] },
      { rowCount: 1 },
      { rows: [{ name: "Investor" }] },
      { rowCount: 1 },
    ]);

    const mockMessages = [
      { payload: { headers: [{ name: "From", value: "founder@example.com" }, { name: "To", value: "investor@example.com" }] } },
      { payload: { headers: [{ name: "From", value: "investor@example.com" }, { name: "To", value: "founder@example.com" }] } },
    ];
    const mockGmail = {
      users: {
        threads: {
          get: vi.fn().mockResolvedValue({ data: { messages: mockMessages } }),
        },
      },
    };
    mockGetGmailClientForUser.mockResolvedValueOnce(mockGmail as any);

    const result = await checkGmailRepliesForUser("user-1");
    expect(result.replied).toBe(1);
    expect(mockGmail.users.threads.get).toHaveBeenCalledWith({
      userId: "me",
      id: "thread-1",
      format: "metadata",
      metadataHeaders: ["From", "To", "Subject", "Message-ID", "In-Reply-To", "References"],
    });
  });

  it("does not mark unrelated threads as REPLIED", async () => {
    const userRow = {
      id: "user-1",
      google_refresh_token: "encrypted",
      connected_gmail_address: "founder@example.com",
      email: "founder@example.com",
    };
    const sendRow = {
      id: "send-1",
      gmail_thread_id: "thread-1",
      investor_email: "investor@example.com",
      status: "SENT",
      sent_at: new Date(),
      investor_id: "inv-1",
    };

    setupMocks([
      { rows: [userRow] },
      { rows: [sendRow] },
    ]);

    const mockMessages = [
      { payload: { headers: [{ name: "From", value: "stranger@other.com" }, { name: "To", value: "founder@example.com" }] } },
      { payload: { headers: [{ name: "From", value: "founder@example.com" }, { name: "To", value: "investor@example.com" }] } },
    ];
    const mockGmail = {
      users: {
        threads: {
          get: vi.fn().mockResolvedValue({ data: { messages: mockMessages } }),
        },
      },
    };
    mockGetGmailClientForUser.mockResolvedValueOnce(mockGmail as any);

    const result = await checkGmailRepliesForUser("user-1");
    expect(result.replied).toBe(0);
  });

  it("is idempotent when reply already processed", async () => {
    const userRow = {
      id: "user-1",
      google_refresh_token: "encrypted",
      connected_gmail_address: "founder@example.com",
      email: "founder@example.com",
    };
    const sendRow = {
      id: "send-1",
      gmail_thread_id: "thread-1",
      investor_email: "investor@example.com",
      status: "SENT",
      sent_at: new Date(),
      investor_id: "inv-1",
    };

    setupMocks([
      { rows: [userRow] },
      { rows: [sendRow] },
      { rows: [{ id: "send-1" }] },
    ]);

    const mockMessages = [
      { payload: { headers: [{ name: "From", value: "founder@example.com" }, { name: "To", value: "investor@example.com" }] } },
      { payload: { headers: [{ name: "From", value: "investor@example.com" }, { name: "To", value: "founder@example.com" }] } },
    ];
    const mockGmail = {
      users: {
        threads: {
          get: vi.fn().mockResolvedValue({ data: { messages: mockMessages } }),
        },
      },
    };
    mockGetGmailClientForUser.mockResolvedValueOnce(mockGmail as any);

    const result = await checkGmailRepliesForUser("user-1");
    expect(result.replied).toBe(1);
    expect(result.processed).toBe(1);
  });
});

describe("checkGmailRepliesForAllUsers", () => {
  it("checks all users with Gmail connections", async () => {
    setupMocks([{ rows: [{ id: "user-1" }, { id: "user-2" }] }]);
    const user1Row = { id: "user-1", google_refresh_token: "enc", connected_gmail_address: "f@ex.com", email: "f@ex.com" };
    const user2Row = { id: "user-2", google_refresh_token: "enc", connected_gmail_address: "f@ex.com", email: "f@ex.com" };

    mockPoolQuery.mockResolvedValueOnce({ rows: [user1Row] });
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    mockPoolQuery.mockResolvedValueOnce({ rows: [user2Row] });
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    const mockGmail = {
      users: {
        threads: {
          get: vi.fn().mockResolvedValue({ data: { messages: [] } }),
        },
      },
    };
    mockGetGmailClientForUser.mockResolvedValue(mockGmail as any);

    const results = await checkGmailRepliesForAllUsers();
    expect(results).toHaveLength(2);
  });
});
