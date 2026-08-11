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

function setupPoolMocks(returns: any[]) {
  vi.clearAllMocks();
  mockUserHasGmailModifyScope.mockReturnValue(true);
  for (const r of returns) {
    mockPoolQuery.mockResolvedValueOnce(r);
  }
}

describe("checkGmailRepliesForUser", () => {
  it("returns early when user has no Gmail connection", async () => {
    setupPoolMocks([{ rows: [] }]);
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

  it("marks outreach as REPLIED when investor replies in thread", async () => {
    const userRow = {
      id: "user-1",
      google_refresh_token: "encrypted",
      connected_gmail_address: "founder@example.com",
      email: "founder@example.com",
      gmail_watch_cursor: null,
    };
    const sendRow = {
      id: "send-1",
      gmail_thread_id: "thread-1",
      investor_email: "investor@example.com",
      status: "SENT",
      sent_at: "2026-08-10T10:00:00Z",
      investor_id: "inv-1",
    };

    setupPoolMocks([
      { rows: [userRow] },
      { rows: [sendRow] },
      { rows: [] },
      { rows: [] },
      { rowCount: 1 },
      { rows: [{ name: "Investor" }] },
      { rowCount: 1 },
      { rowCount: 1 },
    ]);

    const mockMessages = [
      { payload: { headers: [{ name: "From", value: "founder@example.com" }, { name: "To", value: "investor@example.com" }, { name: "Date", value: "Mon, 10 Aug 2026 10:00:00 +0000" }] } },
      { payload: { headers: [{ name: "From", value: "investor@example.com" }, { name: "To", value: "founder@example.com" }, { name: "Date", value: "Mon, 10 Aug 2026 11:00:00 +0000" }] } },
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
      metadataHeaders: ["From", "To", "Subject", "Date", "Message-ID", "In-Reply-To", "References"],
    });
  });

  it("does not mark REPLIED when last message is founder follow-up after investor reply", async () => {
    const userRow = {
      id: "user-1",
      google_refresh_token: "encrypted",
      connected_gmail_address: "founder@example.com",
      email: "founder@example.com",
      gmail_watch_cursor: null,
    };
    const sendRow = {
      id: "send-1",
      gmail_thread_id: "thread-1",
      investor_email: "investor@example.com",
      status: "SENT",
      sent_at: "2026-08-10T10:00:00Z",
      investor_id: "inv-1",
    };

    setupPoolMocks([
      { rows: [userRow] },
      { rows: [sendRow] },
      { rows: [] },
      { rows: [] },
      { rowCount: 1 },
      { rows: [{ name: "Investor" }] },
      { rowCount: 1 },
      { rowCount: 1 },
    ]);

    const mockMessages = [
      { payload: { headers: [{ name: "From", value: "founder@example.com" }, { name: "To", value: "investor@example.com" }, { name: "Date", value: "Mon, 10 Aug 2026 10:00:00 +0000" }] } },
      { payload: { headers: [{ name: "From", value: "investor@example.com" }, { name: "To", value: "founder@example.com" }, { name: "Date", value: "Mon, 10 Aug 2026 11:00:00 +0000" }] } },
      { payload: { headers: [{ name: "From", value: "founder@example.com" }, { name: "To", value: "investor@example.com" }, { name: "Date", value: "Mon, 10 Aug 2026 12:00:00 +0000" }] } },
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
  });

  it("does not mark REPLIED when there are only founder messages", async () => {
    const userRow = {
      id: "user-1",
      google_refresh_token: "encrypted",
      connected_gmail_address: "founder@example.com",
      email: "founder@example.com",
      gmail_watch_cursor: null,
    };
    const sendRow = {
      id: "send-1",
      gmail_thread_id: "thread-1",
      investor_email: "investor@example.com",
      status: "SENT",
      sent_at: "2026-08-10T10:00:00Z",
      investor_id: "inv-1",
    };

    setupPoolMocks([
      { rows: [userRow] },
      { rows: [sendRow] },
      { rows: [] },
      { rowCount: 1 },
    ]);

    const mockMessages = [
      { payload: { headers: [{ name: "From", value: "founder@example.com" }, { name: "To", value: "investor@example.com" }, { name: "Date", value: "Mon, 10 Aug 2026 10:00:00 +0000" }] } },
      { payload: { headers: [{ name: "From", value: "founder@example.com" }, { name: "To", value: "investor@example.com" }, { name: "Date", value: "Mon, 10 Aug 2026 11:00:00 +0000" }] } },
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
      gmail_watch_cursor: null,
    };
    const sendRow = {
      id: "send-1",
      gmail_thread_id: "thread-1",
      investor_email: "investor@example.com",
      status: "SENT",
      sent_at: "2026-08-10T10:00:00Z",
      investor_id: "inv-1",
    };

    setupPoolMocks([
      { rows: [userRow] },
      { rows: [sendRow] },
      { rows: [] },
      { rows: [{ id: "send-1" }] },
      { rowCount: 1 },
    ]);

    const mockMessages = [
      { payload: { headers: [{ name: "From", value: "founder@example.com" }, { name: "To", value: "investor@example.com" }, { name: "Date", value: "Mon, 10 Aug 2026 10:00:00 +0000" }] } },
      { payload: { headers: [{ name: "From", value: "investor@example.com" }, { name: "To", value: "founder@example.com" }, { name: "Date", value: "Mon, 10 Aug 2026 11:00:00 +0000" }] } },
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

  it("does not mark unrelated threads as REPLIED", async () => {
    const userRow = {
      id: "user-1",
      google_refresh_token: "encrypted",
      connected_gmail_address: "founder@example.com",
      email: "founder@example.com",
      gmail_watch_cursor: null,
    };
    const sendRow = {
      id: "send-1",
      gmail_thread_id: "thread-1",
      investor_email: "investor@example.com",
      status: "SENT",
      sent_at: "2026-08-10T10:00:00Z",
      investor_id: "inv-1",
    };

    setupPoolMocks([
      { rows: [userRow] },
      { rows: [sendRow] },
      { rows: [] },
      { rowCount: 1 },
    ]);

    const mockMessages = [
      { payload: { headers: [{ name: "From", value: "stranger@other.com" }, { name: "To", value: "founder@example.com" }, { name: "Date", value: "Mon, 10 Aug 2026 11:00:00 +0000" }] } },
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

  it("advances cursor and eventually processes all sends", async () => {
    const userRow = {
      id: "user-1",
      google_refresh_token: "encrypted",
      connected_gmail_address: "founder@example.com",
      email: "founder@example.com",
      gmail_watch_cursor: null,
    };

    const sends = Array.from({ length: 250 }, (_, i) => ({
      id: `send-${i}`,
      gmail_thread_id: `thread-${i}`,
      investor_email: "investor@example.com",
      status: "SENT",
      sent_at: new Date(Date.now() - i * 86400000).toISOString(),
      investor_id: "inv-1",
    }));

    setupPoolMocks([
      { rows: [userRow] },
      { rows: sends.slice(0, 200) },
      { rows: sends.slice(200) },
      { rowCount: 1 },
    ]);

    const mockMessages = [
      { payload: { headers: [{ name: "From", value: "founder@example.com" }, { name: "To", value: "investor@example.com" }] } },
    ];
    const mockGmail = {
      users: {
        threads: {
          get: vi.fn().mockResolvedValue({ data: { messages: mockMessages } }),
        },
      },
    };
    mockGetGmailClientForUser.mockResolvedValue(mockGmail as any);

    const result = await checkGmailRepliesForUser("user-1");
    expect(result.processed).toBe(250);
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE users SET gmail_watch_cursor"),
      expect.any(Array)
    );
  });

  it("resets cursor when fully caught up", async () => {
    const userRow = {
      id: "user-1",
      google_refresh_token: "encrypted",
      connected_gmail_address: "founder@example.com",
      email: "founder@example.com",
      gmail_watch_cursor: "2026-08-01T00:00:00Z",
    };
    const sendRow = {
      id: "send-1",
      gmail_thread_id: "thread-1",
      investor_email: "investor@example.com",
      status: "SENT",
      sent_at: "2026-08-10T10:00:00Z",
      investor_id: "inv-1",
    };

    setupPoolMocks([
      { rows: [userRow] },
      { rows: [sendRow] },
      { rows: [] },
      { rowCount: 1 },
    ]);

    const mockMessages = [
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

    await checkGmailRepliesForUser("user-1");
    expect(mockPoolQuery).toHaveBeenCalledWith(
      "UPDATE users SET gmail_watch_cursor = NULL WHERE id = $1",
      ["user-1"]
    );
  });
});

describe("checkGmailRepliesForAllUsers", () => {
  it("checks all users with Gmail connections", async () => {
    setupPoolMocks([{ rows: [{ id: "user-1" }, { id: "user-2" }] }]);
    const user1Row = { id: "user-1", google_refresh_token: "enc", connected_gmail_address: "f@ex.com", email: "f@ex.com", gmail_watch_cursor: null };
    const user2Row = { id: "user-2", google_refresh_token: "enc", connected_gmail_address: "f@ex.com", email: "f@ex.com", gmail_watch_cursor: null };

    mockPoolQuery.mockResolvedValueOnce({ rows: [user1Row] });
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 1 });
    mockPoolQuery.mockResolvedValueOnce({ rows: [user2Row] });
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 1 });

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
