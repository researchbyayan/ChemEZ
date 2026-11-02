# Saved chat navigation and retry context

- Opening or restoring a saved conversation scrolls to its latest content. A short-lived resize observer handles lazy diagram rendering and viewport resizing; scrolling or pointer input stops restoration. New answers still anchor once at their beginning rather than following the stream.
- Retry resubmits the preceding user question with its stored command and original answer mode, without applying an unrelated composer follow-up target or selected command.
- Model repair instructions quote the exact current question instead of asking ambiguously for the original chemistry question. Earlier conversation topics are context only.
- Mechanism mode no longer treats “reduced doctor visits” as a request for chemical reduction.
- Inline HTTPS Markdown links open through Electron's existing external-link validation. Unsafe protocols and embedded credentials are not clickable. Optional source links are permitted in the model prompt without requiring them in every answer.

Validation: browser regressions for saved-chat position, retry payload/context, and external links; backend regressions for topic changes through a repair and the nonchemical reduction false positive; TypeScript and answer-policy checks. These are deterministic regressions, not live-provider accuracy evidence. No installers rebuilt or published.

## Follow-up refinements

- Source links in prose are recovered for the References count and displayed as “Click Here” in the answer. Known citations without links can still be resolved on demand.
- Saved Markdown also enforces the no-em-dash prose rule, including HTML entities, while preserving code, math and URL targets.
- Editing and follow-up composers share a divided context header and aligned round controls; editing retains the pencil icon.
- The collapsed floating composer uses a real hover/click target. Its horizontal position does not depend on the transform overridden by global button hover styles.
- Removed obsolete pseudo-element pill animations and unused context-control selectors after replacing those elements.
