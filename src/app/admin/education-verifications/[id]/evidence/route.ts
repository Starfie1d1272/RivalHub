import { NextResponse } from "next/server";
import { getManualEducationEvidenceSignedUrl } from "@/lib/education/evidence-access";
import { ErrorCode, isAppErrorCode } from "@/lib/errors";
import { withRouteObservability } from "@/lib/observability/route";
import { captureException } from "@/lib/observability/server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: RouteContext) {
  return withRouteObservability(request, "/admin/education-verifications/[id]/evidence", async () => {
    try {
      const { id } = await params;
      const signedUrl = await getManualEducationEvidenceSignedUrl({ id });
      return NextResponse.redirect(signedUrl, 302);
    } catch (error) {
      if (isAppErrorCode(error, ErrorCode.UNAUTHORIZED)) return new Response(null, { status: 401 });
      if (isAppErrorCode(error, ErrorCode.FORBIDDEN)) return new Response(null, { status: 403 });
      if (isAppErrorCode(error, ErrorCode.NOT_FOUND) || isAppErrorCode(error, ErrorCode.VALIDATION_FAILED)) {
        return new Response(null, { status: 404 });
      }
      captureException("education.evidence.view_failed", error, {
        scope: "education",
        operation: "evidence.view",
        errorClass: "application",
        retryable: true,
      });
      return new Response(null, { status: 500 });
    }
  });
}
