import type { Page, Response } from "@playwright/test";
import { redactText } from "../../../src/lib/observability/redact";

// Static server readiness only proves that Next is listening. Validate the
// actual document (and streamed compilation errors) before waiting for its UI.
export async function assertPageResponse(response: Response | null): Promise<void> {
  if (!response) throw new Error("Page navigation returned no document response");
  if (response.ok()) return;
  const pathname = new URL(response.url()).pathname;
  throw new Error(`Page ${pathname} returned HTTP ${response.status()}; inspect next-server.safe.log and error-context.md for compilation/runtime diagnostics.`);
}

export async function navigateAndWaitForResponse(
  page: Page,
  url: string,
  predicate: (response: Response) => boolean,
): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onResponse: (response: Response) => void = () => {};
  let onPageError: (error: Error) => void = () => {};
  const response = new Promise<Response>((resolve, reject) => {
    onResponse = value => { if (predicate(value)) resolve(value); };
    onPageError = error => reject(new Error(`Page compilation/runtime error: ${redactText(error.message).slice(0, 2000)}`));
    page.on("response", onResponse);
    page.on("pageerror", onPageError);
    timer = setTimeout(() => reject(new Error("Page loaded but expected response was not received within 30000ms")), 30000);
  });
  try {
    const [result] = await Promise.all([
      response,
      page.goto(url).then(assertPageResponse),
    ]);
    return result;
  } finally {
    clearTimeout(timer);
    page.off("response", onResponse);
    page.off("pageerror", onPageError);
  }
}
