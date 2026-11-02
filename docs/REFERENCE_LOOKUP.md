# Reference lookup

The References panel recovers explicit inline bibliographic citations and accepts
structured references with or without a URL. Missing links are resolved on opening
the panel through an authenticated loopback route and a fixed Crossref API endpoint.
Only the citation title is used for the external metadata query. No provider key,
full answer, or conversation is sent. No new runtime dependency is added.

Matching requires an exact or strongly matching title; where a surname is supplied,
it must also match the publication authors. A match supplies a canonical DOI link
and citation metadata. Publication matching does not verify the scientific claims
in the answer. The original model citation is not shown in the panel and is not silently
rewritten in chat history. The matched title is the source hyperlink; the panel
does not repeat a separate DOI line, while copied citations still include the URL. No confident match or an offline lookup produces
a clearly labelled publication-search action rather than an invented source URL.

Lookup uses a seven-second timeout, at most two concurrent requests, and bounded
in-memory caching. It never runs during ordinary answer generation or startup.

Validation: pure matching/rejection tests, offline failure, route authentication and
request bounds, IPC allowlisting, reference extraction, UI source opening and corrected
citation copy. A live public-citation check returned DOI
10.1001/jamainternmed.2014.5466. UI screenshot is saved in
evaluation/references/resolved-reference-dialog.png. No installers rebuilt.
