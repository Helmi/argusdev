# CI Governance and Red-Build Runbook

## Required Checks (main branch)

Set these as required status checks in branch protection. They map to `.github/workflows/ci.yml`.

- `CI / Verify (Ubuntu, Node 26)`
- `CI / Test (ubuntu-latest, Node 26.x)`
- `CI / Test (macos-latest, Node 26.x)`
- `CI / Test (windows-latest, Node 26.x)`

Policy:
- Merge to `main` only through PRs.
- Keep required approvals at `0` for single-maintainer flow (CI remains the hard gate).

## Red-Build Triage (Fast Path)

1. Identify failing check context and failing step name from the run.
2. Classify:
- Product regression (deterministic failure, code-path specific).
- CI flake/infrastructure (timeout, transient network/install, runner outage).
3. Re-run failed jobs once for suspected flake only.
4. If failure is real:
- Fix immediately or revert the offending PR.
- Add/adjust tests so the same failure mode is caught earlier.
5. If failure is flaky:
- Open a task with failure signature and run URL.
- Add stabilization follow-up (retry policy, deterministic fixture, timeout budget, or test isolation).
6. Keep `main` red for the shortest possible time; prioritize restoring green before new feature merges.

## Maintenance Cadence

Weekly (10 minutes):
- Review failed/retried runs for new flakes or slow steps.

Monthly (30 minutes):
- Validate required checks list still matches live job names.
- Review matrix relevance (OS + Node versions) and remove dead combinations.
- Check dependency/setup drift in CI install steps.

Quarterly (45 minutes):
- Audit CI duration trends and top flaky tests.
- Review whether branch protection settings still match team/release workflow.
