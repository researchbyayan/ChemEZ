# Public installer prerequisites

The unsigned native builds are test candidates. The public workflow at
`.github/workflows/release.yml` requires a signed Mac Intel DMG, signed Apple Silicon
DMG, and signed Windows x64 setup EXE. It does not publish unsigned substitutes.

## GitHub environments

Both environments already exist on `researchbyayan/ChemEZ` and require approval by
`researchbyayan`:

- `release-signing`: grants access to signing and notarization inputs.
- `release-approval`: gates assembly of a draft release after readiness evidence passes.

Add these secrets to the **release-signing environment**, not to this repository or a
chat message:

| Secret | Required value |
| :--- | :--- |
| `MAC_CERT_P12_BASE64` | Base64 encoding of a Developer ID Application `.p12` certificate and private key. |
| `MAC_CERT_PASSWORD` | Password for that `.p12`. |
| `APPLE_ID` | Apple account used for notarization. |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for notarization. |
| `APPLE_TEAM_ID` | Apple Developer team ID matching the certificate. |
| `WIN_CERT_P12_BASE64` | Base64 encoding of the Windows Authenticode `.p12` or `.pfx` certificate and private key. |
| `WIN_CERT_PASSWORD` | Password for the Windows certificate file. |

After uploading, verify only the **names** of the secrets in GitHub's environment
settings. Do not print their values or include them in logs, screenshots, or commits.

## Release sequence

1. Freeze one source commit and run all four native CI jobs on that exact commit.
2. Complete license and dataset redistribution review, live chemistry and image
   evaluation, and clean-machine installation, upgrade, and uninstall checks on the
   advertised operating systems.
3. Record the owner-reviewed evidence and exact source commit in a separate
   `chemez-readiness` artifact. The tracked `release-config/readiness.json` is an
   unapproved template.
4. Run the signed release workflow. Its signing environment requires owner approval.
   It verifies certificates, notarization, packaged app behavior, attribution, and
   the 250,000,000-byte installer limit.
5. After every target passes, approve the `release-approval` environment to assemble
   a **draft** GitHub release. Review the draft and its files before publishing it.

The most recent unsigned native build is linked from [release progress](RELEASE_PROGRESS.md).
