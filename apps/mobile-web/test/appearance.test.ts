import { beforeEach, describe, expect, it } from "vitest";
import { appearanceStore } from "../src/state/appearance";

function resetAppearance() {
  appearanceStore.setState({
    mode: "device",
    profileModes: {},
    profileAccents: {},
    profileSecondaryAccents: {},
    profileShowIcons: {},
  });
}

describe("appearance icon preference", () => {
  beforeEach(resetAppearance);

  it("enables icons by default for profiles without a saved preference", () => {
    expect(appearanceStore.getState().getShowIcons("device:existing-user")).toBe(true);
    expect(appearanceStore.getState().getShowIcons("linked:new-user")).toBe(true);
  });

  it("keeps the icon setting scoped to each profile", () => {
    const store = appearanceStore.getState();

    store.setShowIcons("device:alex", false);
    store.setShowIcons("linked:alex", true);

    expect(appearanceStore.getState().getShowIcons("device:alex")).toBe(false);
    expect(appearanceStore.getState().getShowIcons("linked:alex")).toBe(true);
    expect(appearanceStore.getState().getShowIcons("device:casey")).toBe(true);
  });

  it("treats persisted state from before the preference as enabled", () => {
    appearanceStore.setState({ profileShowIcons: undefined as unknown as Record<string, boolean> });

    expect(appearanceStore.getState().getShowIcons("device:older-profile")).toBe(true);
  });
});
