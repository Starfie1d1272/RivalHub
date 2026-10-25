# CI fixture development indicator

Independent review of the 1101 mobile free-predictions failure identified the
Next development rendering indicator intercepting the real Cancel click.
The first attempt exhausted its click wait, while the retry passed and correctly
failed forbid-flaky. This is framework development UI, not application UI.

The repository uses Next 16.4.2. Both its bundled devIndicators reference and the
[official Next.js reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/devIndicators)
document `devIndicators: false` and explicitly state compile/runtime errors
continue to surface. The configuration was previously absent.

Set the option only when CI is `1`/`true` and the canonical local E2E auth
bootstrap flag is `1`. The existing local harness passes that flag to its dev
server. Ordinary development, local non-CI E2E, and CI builds without this
fixture flag retain the default. No force click, application CSS hiding,
error filtering, assertion removal, timeout change or provider behavior change.

Seven configuration cases cover both CI encodings, missing/false flags and
normal development. A full-object comparison verifies the indicator is the
only changed configuration property. The original user-journey E2E remains
unchanged and needs exact integrated CI; configuration tests alone do not
prove the formerly intercepted click has passed.
