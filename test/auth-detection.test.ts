import { describe, expect, it } from "vitest";
import { isAuthPage } from "../src/ingestion/lystos/selectors.js";

describe("isAuthPage", () => {
  it("detects the Keycloak form", () => {
    expect(isAuthPage("https://account.lystos.com/realms/prod/protocol/openid-connect/auth?x=1")).toBe(true);
  });

  it("detects Lystos's own login gate, which precedes the Keycloak bounce", () => {
    // This is the case that made capture silently skip login and record nothing.
    expect(isAuthPage("https://app.lystos.com/login?ref=/explora?anunciante=particular")).toBe(true);
    expect(isAuthPage("https://app.lystos.com/login")).toBe(true);
  });

  it("treats the post-login callback as logged in", () => {
    expect(isAuthPage("https://app.lystos.com/login#code=abc123&state=xyz")).toBe(false);
  });

  it("treats real app pages as logged in", () => {
    expect(isAuthPage("https://app.lystos.com/explora?anunciante=particular")).toBe(false);
    expect(isAuthPage("https://app.lystos.com/")).toBe(false);
  });
});
