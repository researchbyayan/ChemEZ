# Release hardening checkpoint

The user resumed release work after UI refinement. Native unsigned candidates passed
CI on 2026-10-29 at commit `22200049600b12f3d41ed919d547de6941902bd6`.
Do not publish, sign off readiness, commit Claude's unfinished work, or call this a
production release. Baseline source: `c71cc3f`; initial implementation checkpoint: `dd1d33f`.
Windows target updated to Windows 10 and Windows 11 x64, using one NSIS installer.
Both versions require separate clean-machine installation, upgrade and uninstall evidence.
Neither Windows target has been verified yet.

## Implemented, awaiting final release integration

- Separate About component preserves developer branding/profile links and groups app
  utilities, offline credits, MIT application license, and technical details.
- Narrow, trusted Electron metadata/license/update interfaces; no arbitrary file reads.
- Curated registry plus locked JavaScript/Python dependency inventories generate offline
  credits, license texts and distribution notices. Research-only projects are labeled.
- NMRShiftDB2's exact upstream database license and chem-skill/remark-math license texts
  are included. NMR-derived data retains its own license and adjacent data notices.
- Separate native runtime/build environment and pinned dependency constraints, including
  a Windows pefile version compatible with the pinned PyInstaller.
- App staging, native-architecture metadata, unsigned audit build, signing/readiness/size
  checks, protected three-target workflow, installer QA scripts, draft-only aggregation.
- Reaction caption/tools occupy separate rows. The composer has a faint fading divider.
- Suggestion endpoint and renderer reject serialized answer payloads; original live
  follow-ups, commands and topic-based fallback remain intact. Preview fixture now
  answers plain suggestion requests with a plain question rather than reaction JSON.

## Evidence and issues for resumption

`tmp/production-release/` contains audit logs and artifact sizes/checksums. A full backend
run passed 206 tests. An earlier browser run passed 32 and timed out clicking a Gemini model
control once; the native CI browser suites passed on all four targets at `2220004`. Focused suggestion tests
passed 9 cases after the server guard. Later focused About/UI tests are in `/tmp/chemez-about-*`.

The unsigned DMG is an audit artifact, not an approved installer. The dependency collector
still fell back from the staged app to root `node_modules`; verify/minimize the resulting
ASAR before claiming package savings. No Windows/Apple Silicon installation result exists.
The native unsigned workflow passed on all four jobs: macOS Intel, macOS Apple Silicon,
Windows x64 and Linux x64. GitHub run: https://github.com/researchbyayan/ChemEZ/actions/runs/40887674975
Packaged UI, frozen backend, dual-provider/image, and About smokes passed on the
requested Mac/Windows targets. Test artifact ZIP download sizes: Mac Intel 185,915,627
bytes; Mac Apple Silicon 178,488,282 bytes; Windows x64 180,459,676 bytes. These are
unsigned test artifacts, not exact signed installer sizes. The signed release workflow
and clean-machine tests have not run.

`release-config/readiness.json` is a deliberately unapproved template. Supply a separate
owner-reviewed readiness artifact via `CHEMEZ_READINESS_FILE`, tied to the exact release
commit, to avoid a self-referential tracked commit hash. The draft workflow accepts that
artifact only after all native candidate jobs pass; protected environments require owner
approval. Public publication remains a separate owner action.

Remaining gates: source freeze after Claude finishes; certificates and notarization;
minimum-OS clean-machine installation/upgrade/uninstall checks; live chemistry/image
accuracy suite; dataset/source redistribution review; final size/security/packaged tests.
