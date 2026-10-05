# Security Policy

## Supported versions

Security fixes are provided for the latest release. Users should upgrade to the latest supported release when a fix is published.

## Reporting a vulnerability

Please do not disclose suspected vulnerabilities in a public issue or pull request.

Use GitHub's **Report a vulnerability** feature in the repository's Security tab to send a private report. Include the affected version or commit, reproduction steps, impact, and any suggested mitigation. If private vulnerability reporting is unavailable, contact the repository owner privately through their GitHub profile.

Please allow maintainers reasonable time to investigate and coordinate a fix before public disclosure. Do not include real credentials, customer data, or unrelated personal information in a report.

## Security design notes

- Pull request validation runs with read-only repository permissions.
- Comment publishing runs in a separate `workflow_run` job that checks out trusted default-branch code and does not execute code from the PR.
- LCOV artifacts are untrusted input. The report workflow limits their size, validates the associated run and current PR head, and parses data without executing the artifact.
- Do not enable write permissions for a workflow job that checks out or executes untrusted PR code.
