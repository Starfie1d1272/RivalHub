import { getManualEducationEvidenceSignedUrl } from "@/lib/education/evidence-access";
import { ErrorCode, isAppErrorCode } from "@/lib/errors";
import { withRouteObservability } from "@/lib/observability/route";
import { captureException } from "@/lib/observability/server";

function privateEvidenceResponse(status: number, location?: string) {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  });
  if (location) headers.set("Location", location);
  return new Response(null, { status, headers });
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: RouteContext) {
  return withRouteObservability(
    request,
    "/admin/education-verifications/[id]/evidence",
    async () => {
      try {
        const { id } = await params;
        const signedUrl = await getManualEducationEvidenceSignedUrl({ id });
        return privateEvidenceResponse(302, signedUrl);
      } catch (error) {
        if (isAppErrorCode(error, ErrorCode.UNAUTHORIZED)) return privateEvidenceResponse(401);
        if (isAppErrorCode(error, ErrorCode.FORBIDDEN)) return privateEvidenceResponse(403);
        if (
          isAppErrorCode(error, ErrorCode.NOT_FOUND) ||
          isAppErrorCode(error, ErrorCode.VALIDATION_FAILED)
        ) {
          return privateEvidenceResponse(404);
        }
        captureException("education.evidence.view_failed", error, {
          scope: "education",
          operation: "evidence.view",
          errorClass: "application",
          retryable: true,
        });
        return privateEvidenceResponse(500);
      }
    },
  );
}
