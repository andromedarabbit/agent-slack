import { describe, expect, test } from "bun:test";
import { resolveUserId } from "../src/slack/users.ts";

describe("resolveUserId", () => {
  test("returns user ids unchanged", async () => {
    const client = {
      api: async () => {
        throw new Error("should not call api for user id");
      },
    };
    expect(await resolveUserId(client as never, "U01ABCDEFG")).toBe("U01ABCDEFG");
  });

  test("returns W-prefixed user ids unchanged", async () => {
    const client = {
      api: async () => {
        throw new Error("should not call api for user id");
      },
    };
    expect(await resolveUserId(client as never, "W01ABCDEFG")).toBe("W01ABCDEFG");
  });

  test("resolves @handle via users.list", async () => {
    const client = {
      api: async (method: string) => {
        expect(method).toBe("users.list");
        return {
          ok: true,
          members: [{ id: "U02HANDLE", name: "alice" }],
        };
      },
    };
    expect(await resolveUserId(client as never, "@alice")).toBe("U02HANDLE");
  });

  test("resolves email via users.lookupByEmail", async () => {
    const client = {
      api: async (method: string, params?: Record<string, unknown>) => {
        expect(method).toBe("users.lookupByEmail");
        expect(params?.email).toBe("alice@example.com");
        return {
          ok: true,
          user: { id: "U03EMAIL" },
        };
      },
    };
    expect(await resolveUserId(client as never, "alice@example.com")).toBe("U03EMAIL");
  });

  test("resolves @handle case-insensitively", async () => {
    const client = {
      api: async (method: string) => {
        expect(method).toBe("users.list");
        return {
          ok: true,
          members: [{ id: "U05HANDLE", name: "jinjing" }],
        };
      },
    };
    expect(await resolveUserId(client as never, "@Jinjing")).toBe("U05HANDLE");
  });

  test("falls back to users.list when lookupByEmail is unavailable", async () => {
    const client = {
      api: async (method: string) => {
        if (method === "users.lookupByEmail") {
          throw new Error("missing_scope");
        }
        return {
          ok: true,
          members: [{ id: "U04FALLBACK", name: "alice", profile: { email: "alice@example.com" } }],
        };
      },
    };
    expect(await resolveUserId(client as never, "alice@example.com")).toBe("U04FALLBACK");
  });

  test("resolves email via search.modules when lookupByEmail rejects the token", async () => {
    const client = {
      api: async (method: string, params?: Record<string, unknown>) => {
        if (method === "users.lookupByEmail") {
          throw new Error("not_allowed_token_type");
        }
        expect(method).toBe("search.modules");
        expect(params).toEqual({ module: "people", query: "alice@example.com", count: 5 });
        return { ok: true, items: [{ id: "U06SEARCH", profile: { email: "Alice@example.com" } }] };
      },
    };
    expect(await resolveUserId(client as never, "alice@example.com")).toBe("U06SEARCH");
  });

  test("retries search.modules with the stored org workspace on team_is_restricted", async () => {
    const workspaceUrls: string[] = [];
    const client = {
      api: async (method: string) => {
        if (method === "team.info") {
          return { ok: true, team: { id: "T1", enterprise_domain: "acme" } };
        }
        expect(method).not.toBe("users.list");
        throw new Error(
          method === "search.modules" ? "team_is_restricted" : "not_allowed_token_type",
        );
      },
      forWorkspace: async (url: string) => {
        workspaceUrls.push(url);
        return {
          api: async (method: string) => {
            expect(method).toBe("search.modules");
            return { ok: true, items: [{ id: "U07ORG", profile: { email: "alice@example.com" } }] };
          },
        };
      },
    };
    expect(await resolveUserId(client as never, "alice@example.com")).toBe("U07ORG");
    expect(workspaceUrls).toEqual(["https://acme.enterprise.slack.com"]);
  });

  test("ignores search.modules results whose email does not match exactly", async () => {
    const client = {
      api: async (method: string) => {
        if (method === "users.lookupByEmail") {
          throw new Error("not_allowed_token_type");
        }
        if (method === "search.modules") {
          return {
            ok: true,
            items: [{ id: "U08OTHER", profile: { email: "alice.b@example.com" } }],
          };
        }
        expect(method).toBe("users.list");
        return {
          ok: true,
          members: [{ id: "U09LIST", name: "alice", profile: { email: "alice@example.com" } }],
        };
      },
    };
    expect(await resolveUserId(client as never, "alice@example.com")).toBe("U09LIST");
  });
});
