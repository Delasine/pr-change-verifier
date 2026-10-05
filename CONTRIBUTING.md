# Contributing

Thanks for helping improve PR Change Verifier. Bug reports, documentation fixes, compatibility reports, and focused code contributions are welcome.

## Before opening an issue

- Search existing issues and pull requests to avoid duplicates.
- For bug reports, include the Node.js version, runner/OS, relevant workflow configuration, a minimal LCOV sample, expected behavior, and actual behavior.
- Remove secrets, private source, and personal data from logs and examples.
- Do not post suspected vulnerabilities in public issues; follow [SECURITY.md](SECURITY.md).

## Development workflow

1. Fork the repository and create a focused branch.
2. Make the smallest change that addresses the issue.
3. Add or update tests for behavior changes.
4. Run `npm test` and `git -c core.whitespace=cr-at-eol diff --check` (the repository uses Windows-friendly CRLF working-tree line endings).
5. Open a pull request with the problem, the approach, test results, and any compatibility or security implications.

The project uses Node.js built-in modules and the built-in test runner. No dependency installation is required for local tests.

## Pull request expectations

- Keep changes focused and explain any behavior change.
- Preserve the distinction between uncovered and unmeasured lines.
- Do not add telemetry, external source uploads, or new runtime dependencies without discussing the trade-offs first.
- Never weaken the read-only permissions of workflows that execute pull request code.
- Update documentation when inputs, outputs, workflow requirements, or limitations change.

By submitting a contribution, you agree that it may be distributed under the repository's [MIT License](LICENSE).
