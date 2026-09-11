import type { CommunityGroup, SeasonContact, SeasonPublicInfo } from "@/db/schema";

export const SEASON_PUBLIC_ASSETS_BUCKET = "season-public-assets";

export type PublicSeasonInfo = {
  rules: { label: string; href: string };
  groups: PublicCommunityGroup[];
  contacts: PublicContact[];
};

export type PublicCommunityGroup = {
  id: string;
  label: string;
  audience: string | null;
  status: "active" | "closed";
  groupNumber: string | null;
  qrImageUrl: string | null;
  joinUrl: string | null;
  note: string | null;
};

export type PublicContact = {
  id: string;
  label: string;
  publicName: string | null;
  value: string;
  href: string | null;
  note: string | null;
};

const UNSAFE_HREF_CHARACTER = /[\\\u0000-\u001f\u007f\s]/u;

/** Only same-site paths and explicit HTTP(S) URLs may become public links. */
export function isSafePublicHref(value: string, options: { allowMailto?: boolean } = {}): boolean {
  const href = value.trim();
  if (!href || UNSAFE_HREF_CHARACTER.test(href)) return false;
  if (href.startsWith("/")) return !href.startsWith("//");
  if (options.allowMailto && /^mailto:[^\s\\]+$/i.test(href)) return true;
  if (!/^https?:\/\//i.test(href)) return false;
  try {
    const url = new URL(href);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function safePublicHref(value: string | null | undefined, fallback: string | null = null, options?: { allowMailto?: boolean }): string | null {
  const href = value?.trim();
  return href && isSafePublicHref(href, options) ? href : fallback;
}

export function isExternalPublicHref(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function seasonPublicAssetUrl(path: string | null): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!base) return null;
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${SEASON_PUBLIC_ASSETS_BUCKET}/${encodedPath}`;
}

export function toPublicSeasonInfo(
  info: Pick<SeasonPublicInfo, "rulesLabel" | "rulesHref"> | null,
  groups: readonly Pick<CommunityGroup, "id" | "label" | "audience" | "status" | "groupNumber" | "qrImagePath" | "joinUrl" | "note" | "sortOrder">[],
  contacts: readonly Pick<SeasonContact, "id" | "label" | "publicName" | "value" | "href" | "note" | "sortOrder">[],
): PublicSeasonInfo {
  return {
    rules: {
      label: info?.rulesLabel ?? "赛事规则",
      href: safePublicHref(info?.rulesHref, "/rules") ?? "/rules",
    },
    groups: [...groups]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
      .map((group) => group.status === "active"
        ? {
            id: group.id,
            label: group.label,
            audience: group.audience,
            status: group.status,
            groupNumber: group.groupNumber,
            qrImageUrl: seasonPublicAssetUrl(group.qrImagePath),
            joinUrl: safePublicHref(group.joinUrl),
            note: group.note,
          }
        : {
            id: group.id,
            label: group.label,
            audience: group.audience,
            status: group.status,
            groupNumber: null,
            qrImageUrl: null,
            joinUrl: null,
            note: group.note,
          }),
    contacts: [...contacts].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)).map((contact) => ({
      id: contact.id,
      label: contact.label,
      publicName: contact.publicName,
      value: contact.value,
      href: safePublicHref(contact.href, null, { allowMailto: true }),
      note: contact.note,
    })),
  };
}

export function activeGroupCount(info: PublicSeasonInfo): number {
  return info.groups.filter((group) => group.status === "active").length;
}
