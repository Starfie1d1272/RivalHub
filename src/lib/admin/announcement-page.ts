import "server-only";
import { z } from "zod";
import { listAnnouncementAdminSummaries, getAnnouncementForAdmin, type AnnouncementAdminFilters } from "@/lib/announcements/read-model";

/** Scope stays in the canonical owner. Clamp only the presentation page. */
export async function loadAdminAnnouncementPage(input: AnnouncementAdminFilters & { page?: string }) {
  const requested = Number(input.page);
  const page = Number.isSafeInteger(requested) && requested > 0 && requested <= 10000 ? requested : 1;
  const result = await listAnnouncementAdminSummaries({ ...input, page });
  const last = Math.max(1, Math.ceil(result.total / result.pageSize));
  return page > last ? listAnnouncementAdminSummaries({ ...input, page: last }) : result;
}

/** Route ids are untrusted; preserve the former not-found result for invalid UUIDs. */
export async function getAdminAnnouncementDetail(id: string, scope: AnnouncementAdminFilters) {
  return z.guid().safeParse(id).success ? getAnnouncementForAdmin(id, scope) : null;
}
