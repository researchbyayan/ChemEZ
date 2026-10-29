# ChemEZ recovery and release runbook

## Scope

ChemEZ is a local desktop app, not a hosted multi-user service. The authenticated
loopback backend and operating-system user account define its local trust boundary.
Do not publish its local port as a public API. AI providers remain remote services.

## Preserve a recoverable checkpoint

Keep source in version control, retain the previous verified application artifact,
and copy important local conversation databases to storage you control. This
checkout also has a pre-audit patch and untracked-file archive under
`tmp/checkpoints/pre-launchworthy-2026-10-26/`; the manifest has SHA-256 checksums.
That checkpoint is local and ignored by git, not an off-device disaster backup.

## Conversation backups

The database is `chemez.sqlite3` under Electron's userData directory. Normally:

- macOS: `~/Library/Application Support/ChemEZ/`
- Windows: `%APPDATA%\ChemEZ\`
- Linux: `$XDG_CONFIG_HOME/ChemEZ/`, falling back to `~/.config/ChemEZ/`
- A test or recovery instance can use `CHEMEZ_PROFILE` to select another folder.

Use the SQLite backup API rather than copying only the main database while WAL
writes may be active:

```sh
python scripts/backup-data.py --source "/absolute/app data/chemez.sqlite3" --output "/absolute/backups/chemez-2026-10-26.sqlite3"
```

The destination folder must already exist. The tool refuses to overwrite any
file and checks source and destination integrity. It preserves conversations,
images, cached image observations, modes, and provider configuration. API keys
in `credentials.json` or session memory are not copied.
Protect backups as private: they contain the conversation images and text. No
scheduled backup or automatic cloud copy is enabled by this tool.

## Restore rehearsal before replacing anything

1. Create a NEW empty recovery directory. Keep the original profile intact.
2. Run the same tool with the backup as `--source` and the NEW directory's
   `chemez.sqlite3` as `--output`.
3. Close other ChemEZ windows, then launch the app with `CHEMEZ_PROFILE` pointing
   to that recovery directory. Use a session-only key for this rehearsal if needed.
4. Verify titles, messages, images, diagrams and answer modes, then reconnect APIs.
5. Only after verification, keep using the restored profile or carefully move it
   into place while all ChemEZ processes are stopped. Retain the original first.

Automated restore tests use synthetic conversations, not the user's real data.
A synthetic restore proves the tool, not the availability of an off-device backup.
Deleting a chat does not delete independent backup files. Remove those yourself
when you no longer want the retained data.

## Troubleshooting

- Provider 401: reconnect that API's key; do not repeatedly generate new keys for
  rate limits or availability errors.
- 404: verify an API-enabled model and endpoint; a downloadable catalog entry is
  not evidence of hosted access.
- 429: respect the account's limits. The app only retries short explicit NVIDIA
  Retry-After responses; it never rotates models/keys or enables paid billing.
- 503/timeout: cancel or retry later. No local model installation is necessary.
- Image issues: distinguish an image reader from an image generator. Reconnect
  the optional reader independently from the chat model.
- Repeated local failures: preserve the profile before troubleshooting; run the
  packaged smoke tests in their isolated profiles. Do not delete the user's DB.

## Release gate

Run the build, backend/JS/browser tests, image safety and recovery checks, and both
packaged smoke scripts. Save output and screenshots. Test actual chemistry and
image recognition with the chosen hosted model. Review errors against reference
answers; a rendering pass is not an accuracy pass.

Retain the previous verified app before replacing it. Rehearse rollback against a
copy of the data, because an older version may not understand a new schema. Code
signing/notarization require owner credentials. Native Windows/Linux/Apple Silicon
CI outcomes must be recorded from actual runs; configuration alone is not evidence.
No release upload, signing request, remote telemetry or billing change is automatic.
