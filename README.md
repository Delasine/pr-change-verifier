# PR Change Verifier

**Measure test coverage for lines added in a pull request, using the LCOV report your project already produces.**

[![CI](https://github.com/Delasine/pr-change-verifier/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Delasine/pr-change-verifier/actions/workflows/ci.yml)

> 中文简介：这是一个 GitHub Action，将 PR 新增代码行与现有 LCOV 测试报告比对，区分已覆盖、未覆盖和无覆盖记录。默认只报告，不阻止合并；不会调用 AI 服务。欢迎试用、反馈和贡献。详见下方 [中文说明](#中文说明)。

## Features

- Reports added lines as **covered**, **uncovered**, or **not measured**.
- Shows aggregate and per-file changed-line coverage.
- Emits GitHub warning annotations for uncovered added lines.
- Supports an optional minimum-coverage threshold and glob-based path exclusions.
- Writes a job summary and exposes numeric and JSON Action outputs.
- Can create or update a pull request comment.
- Does not upload source code to an external service or call an AI service.

Coverage means that a line was executed according to the supplied LCOV file; it does not prove that a test asserts the right behavior.

## Quick start

Generate `coverage/lcov.info` with your project's existing test tooling, then add the action to a pull request workflow:

```yaml
name: PR verification

on:
  pull_request:

permissions:
  contents: read
  pull-requests: read

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      # Replace with your test command if needed; this generates coverage/lcov.info.
      - run: npx --yes c8@10.1.3 --reporter=lcov --reporter=text npm test
      - uses: Delasine/pr-change-verifier@v0.1.0
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          lcov-file: coverage/lcov.info
          comment: "false"
```

Replace the test command and LCOV path with the ones used by your project. The example deliberately disables PR comments: untrusted pull request code must not run in a job with a write-capable token.

### Safely publishing PR comments

To comment with coverage produced by the PR itself, use a two-workflow handoff:

1. In the `pull_request` workflow, run tests with read-only permissions, invoke this action with `comment: "false"`, and upload only the LCOV report as an artifact.
2. In a `workflow_run` workflow, check out trusted code from the default branch, validate that the successful run still matches the current PR head, download the artifact from that exact run, then invoke this action with `pr-number` and comments enabled.

Never grant `issues: write` or `pull-requests: write` to a job that checks out or executes untrusted PR code. A tested example is in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) and [`.github/workflows/pr-report.yml`](.github/workflows/pr-report.yml); adapt its workflow name and artifact name for your repository.

### Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `github-token` | Yes | — | Token with `pull-requests: read`; comment publishing also requires `pull-requests: write`. |
| `lcov-file` | Yes | — | Path to the LCOV report. |
| `pr-number` | No | `""` | PR number override for a trusted workflow such as `workflow_run`. |
| `comment` | No | `"true"` | Create or update the report comment. |
| `min-coverage` | No | `""` | Minimum measured changed-line coverage percentage (0–100). Empty disables the threshold. |
| `fail-on-uncovered` | No | `"false"` | Fail when at least one measured added line is uncovered. |
| `exclude-paths` | No | `""` | Comma- or newline-separated glob patterns (`*`, `**`, `?`) to exclude files. |

The threshold denominator includes only added lines with LCOV data. If no added lines can be measured, a configured threshold fails rather than treating missing data as success. Excluded lines are reported separately.

### Outputs

`covered-lines`, `uncovered-lines`, `unmeasured-lines`, `excluded-lines`, `changed-files`, `coverage` (`n/a` when no lines are measurable), and `report` (JSON).

## Development

Requirements: Node.js 20 or newer.

```sh
npm test
```

The tests use Node's built-in test runner; no install step is needed. CI additionally generates LCOV with `c8` to exercise the GitHub Action workflow.

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report security issues privately according to [SECURITY.md](SECURITY.md).

## Limitations

- GitHub may omit diff patches for binary files or very large changes; these are listed as uninspectable rather than counted as uncovered.
- Added lines absent from the LCOV report are “not measured,” not uncovered.
- If multiple LCOV paths could match one repository path, the action does not guess.
- GitHub limits the number of annotations; the summary and PR comment contain the aggregate report.
- The action does not assess assertion quality, business risk, or functional correctness.
- Fork PRs normally receive a read-only `GITHUB_TOKEN`; use the trusted `workflow_run` handoff for comments.

## License

Distributed under the [MIT License](LICENSE).

## 中文说明

PR Change Verifier 是一个 GitHub Action，将 PR 新增代码行与项目已有的 LCOV 覆盖率报告比对，展示已覆盖、未覆盖、未测量行数和逐文件覆盖率，并可生成行级提醒、Job Summary 及 PR 评论。

**安全建议：**PR 检查工作流保持只读并设置 `comment: "false"`。若要发布评论，请使用可信任的 `workflow_run` 工作流：只运行默认分支代码，校验 PR head 和 artifact 后再写评论。不要让执行外部 PR 代码的 job 获得写权限。

本地运行测试：`npm test`。欢迎阅读 [贡献指南](CONTRIBUTING.md)、遵守 [行为准则](CODE_OF_CONDUCT.md)，并按 [安全政策](SECURITY.md) 私下报告漏洞。项目采用 [MIT 许可证](LICENSE)。
