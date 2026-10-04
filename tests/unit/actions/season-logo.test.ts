import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), select: vi.fn(), transaction: vi.fn(), replace: vi.fn(), upload: vi.fn(), remove: vi.fn(), tags: vi.fn(), path: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { select: mocks.select, transaction: mocks.transaction } }));
vi.mock("@/lib/auth/session", () => ({ requireAdmin: mocks.admin, auditActorId: () => "actor" }));
vi.mock("@/lib/season-public-info/commands", async (original) => ({ ...await original<typeof import("@/lib/season-public-info/commands")>(), replaceSeasonLogoInTx: mocks.replace }));
vi.mock("@/lib/season-public-info/storage", () => ({ seasonPublicAssetsStorage: { upload: mocks.upload, remove: mocks.remove } }));
vi.mock("@/lib/revalidation", () => ({ updatePublicSeasonTags: mocks.tags, updatePublicSeasonInfoTag: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.path }));
vi.mock("@/lib/observability/server", () => ({ logEvent: vi.fn(), captureException: vi.fn() }));
import { uploadSeasonLogo, removeSeasonLogo } from "@/actions/season-public-info";
import { seasonPublicAssetUrl } from "@/lib/season-public-info/presentation";

const id = "11111111-1111-4111-8111-111111111111";
const oldPath = `${id}/event-logo/22222222-2222-4222-8222-222222222222.png`;
function form(file: File) { const data = new FormData(); data.set("file", file); return data; }
const image = () => form(new File(["image"], "logo.png", { type: "image/png" }));
describe("event logo action boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.upload.mockResolvedValue(undefined);
    mocks.remove.mockResolvedValue(undefined);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    mocks.admin.mockResolvedValue({ role: "season_admin", seasonIds: [id] });
    mocks.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ slug: "event" }] }) }) });
    mocks.transaction.mockImplementation((work) => work({}));
    mocks.replace.mockResolvedValue({ slug: "event", oldLogoUrl: seasonPublicAssetUrl(oldPath) });
  });
  it("rejects empty, oversized and unsupported files before Storage", async () => {
    for (const file of [new File([], "empty.png", { type: "image/png" }), new File([new Uint8Array(1048577)], "big.png", { type: "image/png" }), new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" })]) {
      expect((await uploadSeasonLogo(id, form(file))).success).toBe(false);
    }
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("rejects cross-event admins and unauthenticated callers before upload", async () => {
    mocks.admin.mockResolvedValue({ role: "season_admin", seasonIds: [] });
    expect((await uploadSeasonLogo(id, image())).success).toBe(false);
    mocks.admin.mockRejectedValue(new Error("unauthorized"));
    expect((await uploadSeasonLogo(id, image())).success).toBe(false);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("uses the canonical bucket owner, unique URLs and invalidates public caches", async () => {
    const result = await uploadSeasonLogo(id, image());
    expect(result.success).toBe(true);
    const path = mocks.upload.mock.calls[0]![0];
    expect(path).toMatch(new RegExp(`^${id}/event-logo/[0-9a-f-]+\\.png$`));
    expect(mocks.replace).toHaveBeenCalledWith({}, expect.objectContaining({ seasonIds: [id] }), id, seasonPublicAssetUrl(path));
    expect(mocks.remove).toHaveBeenCalledWith(oldPath);
    expect(mocks.tags).toHaveBeenCalledWith("event", undefined, { statistics: false });
    expect(mocks.path).toHaveBeenCalledWith("/event", "layout");
    await uploadSeasonLogo(id, image());
    expect(mocks.upload.mock.calls[1]![0]).not.toBe(path);
  });
  it("keeps the persisted logo when upload fails and cleans new objects on rollback", async () => {
    mocks.upload.mockRejectedValueOnce(new Error("storage unavailable"));
    expect((await uploadSeasonLogo(id, image())).success).toBe(false);
    expect(mocks.replace).not.toHaveBeenCalled();
    mocks.replace.mockRejectedValueOnce(new Error("database unavailable"));
    expect((await uploadSeasonLogo(id, image())).success).toBe(false);
    expect(mocks.remove).toHaveBeenCalledWith(mocks.upload.mock.calls[1]![0]);
    expect(mocks.remove).not.toHaveBeenCalledWith(oldPath);
    expect(mocks.tags).not.toHaveBeenCalled();
  });
  it("reports committed success even if obsolete-object cleanup fails", async () => {
    mocks.remove.mockRejectedValue(new Error("cleanup unavailable"));
    expect((await uploadSeasonLogo(id, image())).success).toBe(true);
  });
  it("removes to null without deleting foreign or historical URLs", async () => {
    mocks.replace.mockResolvedValue({ slug: "event", oldLogoUrl: "https://example.com/historical.png" });
    expect((await removeSeasonLogo(id)).success).toBe(true);
    expect(mocks.replace).toHaveBeenCalledWith({}, expect.anything(), id, null);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.tags).toHaveBeenCalled();
  });
});
