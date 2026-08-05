# Submitting to AppSource

What Microsoft requires, what this repository already produces, and what only
a human with a Partner Center account can do.

Everything in the first table is generated and checked on every release build.
Everything in the second is a decision or an account action and cannot be
automated away.

## What the build produces

| Requirement                             | Where it comes from                        | Checked by                                             |
| --------------------------------------- | ------------------------------------------ | ------------------------------------------------------ |
| Four-part `<Version>`                   | the release tag — `v1.2.3` → `1.2.3.0`     | `pnpm manifest:validate`, `tools/test/version.test.ts` |
| Unique `<Id>` GUID, never changed       | `ADDIN_ID` in `tools/manifest/generate.ts` | `manifest:validate`                                    |
| `<DisplayName>` ≤ 125 characters        | the generator                              | `manifest:validate`                                    |
| `<Description>` ≤ 250 characters        | the generator (currently 234)              | `manifest:validate`                                    |
| HTTPS for every URL                     | `resolveBaseUrl()`                         | `manifest:validate`                                    |
| `<SupportUrl>` resolving to a real page | `support.html`, generated                  | `manifest:validate`                                    |
| 64×64 and 128×128 listing icons         | `tools/icons/`                             | `manifest:validate`                                    |
| `<AppDomains>` covering the origin      | the generator                              | `manifest:validate`                                    |
| Least privilege in `<Permissions>`      | `ReadWriteDocument`                        | `manifest:validate`                                    |
| Privacy policy at a stable URL          | `privacy.html`, generated                  | `tools/test/appsource.test.ts`                         |
| Terms of use at a stable URL            | `terms.html`, generated                    | `tools/test/appsource.test.ts`                         |

`pnpm build:release` runs the validator and fails the build on any error, so a
manifest that AppSource would reject does not reach a release.

### The validator is not Microsoft's

`tools/manifest/validate.ts` checks, offline, the rules that are checkable from
the file. Microsoft's own validator posts the manifest to a web service, which
is why it is not wired into CI — it needs a network, and this project takes on
no dependency it does not need. Run it once by hand before submitting:

```console
$ npx office-addin-manifest validate apps/web/dist/manifest.xml
```

Passing the local validator does not mean the submission will be accepted.
Failing it means it will not be.

## What a person has to do

1. **Enrol in Partner Center** as a developer. Individual or company; a company
   account needs verifiable business identity and takes longer.
2. **Check the publisher name still matches.** `<ProviderName>` is
   **William Barnhart**. AppSource rejects a submission whose provider name
   does not match the Partner Center account, so if the listing is later
   published under a company or firm account, change it in
   `tools/manifest/generate.ts` first — the test in
   `tools/test/appsource.test.ts` pins the current value, so it will not drift
   silently.
3. **Fill in the listing**: short and long description, search terms, category
   (Productivity / Legal), screenshots (1366×768), and a 300×300 listing logo.
   The logo is a Partner Center upload, separate from the manifest icons.
4. **Provide test instructions.** Validation is done by a human who has to see
   the add-in work. Give them sample text with a citation error in it — the
   demo corpus in `packages/core/test/fixtures/` is exactly this, and the app's
   built-in sample document is a shorter version.
5. **Answer the data-handling questions.** See below.
6. **Submit and wait.** Rejections generally arrive as a specific policy
   number; the policies are at
   <https://learn.microsoft.com/legal/marketplace/certification-policies>.

## The data-handling questions

Partner Center asks what data the add-in collects and transmits. For ReCite the
answers are unusually short, and it is worth being precise rather than
modest — the answer is genuinely "none", and that is checkable.

| Question                                    | Answer                                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Does the add-in collect personal data?      | No.                                                                                                                                              |
| Does it transmit document content anywhere? | No. There is no server. `connect-src 'none'` in the Content Security Policy means the browser refuses to open a connection.                      |
| Does it use cookies or local storage?       | No. Nothing is persisted between sessions.                                                                                                       |
| Does it use analytics or telemetry?         | No.                                                                                                                                              |
| Does it require sign-in?                    | No. There are no accounts.                                                                                                                       |
| Which external services does it call?       | One: `office.js` from Microsoft's own CDN, which Office requires be loaded rather than bundled. No document content is involved in that request. |
| Where is data stored?                       | Nowhere. Document text exists only in page memory and is gone when the pane closes.                                                              |

`docs/compliance.md` covers the same ground in the form a law firm's security
review asks for it, including what GitHub Pages and Microsoft can observe.

## Things that will get a submission rejected

Worth knowing before rather than after:

- **A manifest version that does not increase.** Word and the store both key
  upgrades on `<Version>`. A resubmission with the same number is treated as
  the same build. This is also why a prerelease tag is a trap — `v1.2.3-rc.1`
  and `v1.2.3-rc.2` both produce `1.2.3.0`. Use a full release tag.
- **A `<SupportUrl>` that 404s.** It is checked, by a person.
- **A privacy policy URL that does not describe this product.** A generic
  company policy that never mentions the add-in comes back.
- **Screenshots showing a different version** than the one submitted.
- **Claims in the listing the product does not make good on.** For ReCite the
  live wire is verification: the listing must not imply the add-in confirms
  that cited cases exist. Offline it does not, and `terms.html` says so
  plainly. Keep the listing consistent with that.

## After a version bump

Word caches manifests aggressively. Once a new version is published, a tester
who already has the add-in installed will usually need to remove and re-add it
before the pane changes. This is normal and not a symptom of a failed deploy —
verify what the site is serving with `curl` before chasing it:

```console
$ curl -fsSL https://wbarnha.github.io/ReCite/manifest.xml | grep '<Version>'
```
