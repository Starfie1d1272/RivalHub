import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), select: vi.fn(), transaction: vi.fn(), replace: vi.fn(), upload: vi.fn(), remove: vi.fn(), tags: vi.fn(), path: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { select: mocks.select, transaction: mocks.transaction } }));
vi.mock("@/lib/auth/session", () => ({ requireAdmin: mocks.admin, auditActorId: () => "actor" }));
vi.mock("@/lib/season-public-info/commands", async (original) => ({ ...await original<typeof import("@/lib/season-public-info/commands")>(), replaceSeasonLogoInTx: mocks.replace }));
vi.mock("@/lib/season-public-info/storage", () => ({ seasonPublicAssetsStorage: { upload: mocks.upload, remove: mocks.remove } }));
vi.mock("@/lib/revalidation", () => ({ updatePublicSeasonTags: mocks.tags, updatePublicSeasonInfoTag: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.path }));
vi.mock("@/lib/observability/server", () => ({ logEvent: vi.fn(), captureException: vi.fn() }));
import { uploadSeasonLogo } from "@/actions/season-public-info";
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
  it("rejects cross-event admins and unauthenticated callers before upload", async () => {
    mocks.admin.mockResolvedValue({ role: "season_admin", seasonIds: [] });
    expect((await uploadSeasonLogo(id, image())).success).toBe(false);
    mocks.admin.mockRejectedValue(new Error("unauthorized"));
    expect((await uploadSeasonLogo(id, image())).success).toBe(false);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
