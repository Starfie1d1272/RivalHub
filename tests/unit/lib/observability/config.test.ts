import { describe, expect, it } from "vitest";
import { getBetterStackConfig } from "@/lib/observability/config";

describe("Better Stack OTLP configuration", () => {
  it("is disabled in Development even when credentials are present", () => {
    const result = getBetterStackConfig({
      NODE_ENV: "development",
      BETTER_STACK_SOURCE_TOKEN: "token",
      BETTER_STACK_INGESTING_HOST: "logs.example.com",
    });
    expect(result).toMatchObject({ enabled: false, reason: "environment_disabled", environment: "development" });
  });

  it("requires both credentials in Preview or Production", () => {
    expect(getBetterStackConfig({ VERCEL_ENV: "preview", BETTER_STACK_SOURCE_TOKEN: "token" })).toMatchObject({
      enabled: false,
      reason: "missing_credentials",
    });
  });

  it("builds separate OTLP trace and log endpoints from the safe host contract", () => {
    const result = getBetterStackConfig({
      VERCEL_ENV: "production",
      BETTER_STACK_SOURCE_TOKEN: "source-token",
      BETTER_STACK_INGESTING_HOST: "https://logs.example.com/",
    });
    expect(result).toMatchObject({
      enabled: true,
      environment: "production",
      config: {
        baseUrl: "https://logs.example.com",
        tracesUrl: "https://logs.example.com/v1/traces",
        logsUrl: "https://logs.example.com/v1/logs",
        headers: { Authorization: "Bearer source-token" },
      },
    });
  });

  it("rejects non-HTTPS, path, and header-injection hosts/tokens", () => {
    expect(getBetterStackConfig({ VERCEL_ENV: "production", BETTER_STACK_SOURCE_TOKEN: "token\n", BETTER_STACK_INGESTING_HOST: "logs.example.com" }).reason).toBe("invalid_credentials");
    expect(getBetterStackConfig({ VERCEL_ENV: "production", BETTER_STACK_SOURCE_TOKEN: "token", BETTER_STACK_INGESTING_HOST: "http://logs.example.com" }).reason).toBe("invalid_credentials");
    expect(getBetterStackConfig({ VERCEL_ENV: "production", BETTER_STACK_SOURCE_TOKEN: "token", BETTER_STACK_INGESTING_HOST: "logs.example.com/path" }).reason).toBe("invalid_credentials");
  });
});
