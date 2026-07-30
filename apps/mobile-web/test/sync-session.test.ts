import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthResponse, User } from "@spending-tracker/shared";
import { api } from "../src/lib/api";
import { sessionStore } from "../src/state/session";

const user: User = {
  id: "linked-user",
  email: null,
  name: "Linked profile",
  avatarUrl: null,
  googleSub: null,
  deviceId: null,
  isDeviceOnly: false,
  currency: "USD",
  createdAt: "2026-07-30T00:00:00.000Z",
  updatedAt: "2026-07-30T00:00:00.000Z",
};

const renewedSession: AuthResponse = {
  user,
  accessToken: "renewed-access-token",
  refreshToken: "non-expiring-refresh-token",
};

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStore.setState({
    accessToken: null,
    refreshToken: null,
    user: null,
    activeProfile: null,
    activeLinkedProfileUserId: null,
    staleLinkedProfileUserId: null,
    deviceProfile: null,
    linkedProfiles: [],
  });
});

describe("Sync Code session recovery", () => {
  it("renews a remembered linked profile with its Sync Code before using an expiring refresh token", async () => {
    sessionStore.setState({
      accessToken: "expired-access-token",
      refreshToken: "old-refresh-token",
      user,
      activeProfile: "linked",
      activeLinkedProfileUserId: user.id,
      linkedProfiles: [
        {
          accessToken: "expired-access-token",
          refreshToken: "old-refresh-token",
          user,
          pairingCode: "ABCD-EFGH",
        },
      ],
    });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toContain("/auth/transfer-consume");
      return new Response(JSON.stringify(renewedSession), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.restorePersistedSession()).resolves.toEqual(renewedSession);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sessionStore.getState()).toMatchObject({
      accessToken: renewedSession.accessToken,
      refreshToken: renewedSession.refreshToken,
      activeProfile: "linked",
    });
  });
});
