import "server-only";
import { listAnnouncementAdminSummaries, type AnnouncementAdminFilters } from "@/lib/announcements/read-model";

/** Scope stays in the canonical owner. Clamp only the presentation page. */
export async function loadAdminAnnouncementPage(input: AnnouncementAdminFilters & { page?: string }) {
  const requested = Number(input.page);
  const page = Number.isSafeInteger(requested) && requested > 0 && requested <= 10000 ? requested : 1;
  const result = await listAnnouncementAdminSummaries({ ...input, page });
  const last = Math.max(1, Math.ceil(result.total / result.pageSize));
  return page > last ? listAnnouncementAdminSummaries({ ...input, page: last }) : result;
}
