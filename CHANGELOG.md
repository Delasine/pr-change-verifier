# Changelog

Notable changes to PR Change Verifier are documented here.

## Unreleased

- Nothing yet.

## 0.2.0 - 2026-10-05

- Add the optional `fail-on-unmeasured` input to fail when added lines have no matching LCOV data.

## 0.1.0 - 2026-10-05

- Initial GitHub Action for changed-line coverage reporting from LCOV.
- Add aggregate and per-file reports, annotations, configurable thresholds, exclusions, and Action outputs.
- Add a trusted workflow handoff for publishing PR coverage comments without granting write permissions to PR code.
