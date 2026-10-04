# PR Change Verifier

一个 GitHub Action MVP：读取 Pull Request 新增的代码行，并将它们与仓库现有测试生成的 LCOV 报告比对。它报告**变更行覆盖情况**，不声称覆盖率等于正确性。

## 当前功能

- 仅统计 PR diff 中新增的行；删除文件不计入。
- 将新增行分为已覆盖、未覆盖和无覆盖记录三类。
- 显示总览及逐文件覆盖率；对未覆盖新增行生成 GitHub 行级 warning annotation。
- 可按 changed-line coverage 门槛使检查失败，并用 glob 模式排除生成文件、文档等路径。
- 将计数和完整 JSON 报告暴露为 Action outputs，供后续工作流步骤使用。
- 生成 GitHub Actions Job Summary，并创建或更新一条 PR 评论。
- 默认只报告，不阻止合并；可选开启未覆盖行失败策略。
- 只在 GitHub Actions runner 内处理 diff 和 LCOV 文件，不调用 AI 服务。

## 接入方式

先在项目已有测试流程中生成 `coverage/lcov.info`，然后在 `.github/workflows/pr.yml` 中增加：

```yaml
name: PR verification

on:
  pull_request:

permissions:
  contents: read
  pull-requests: read
  issues: write

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      # 替换为项目现有的测试命令，确保生成 LCOV 文件。
      - run: npx --yes c8@10.1.3 --reporter=lcov --reporter=text npm test
      # 发布版本后替换为实际 owner/repo 和版本标签；正式工作流优先固定到完整 commit SHA。
      - uses: your-org/pr-change-verifier@v0.1.0
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          lcov-file: coverage/lcov.info
          min-coverage: "80"
          exclude-paths: |
            **/*.generated.js
            docs/**
          # 默认 false。团队确认规则后再考虑设为 true。
          fail-on-uncovered: "false"
```

示例假定测试命令会生成 `coverage/lcov.info`。若项目使用其他测试工具或报告目录，请相应调整测试命令与 `lcov-file`。

`min-coverage` 仅按**有 LCOV 行记录的新增行**计算；没有可测行时门槛检查失败，以免把缺失数据当作通过。留空则不启用门槛。`exclude-paths` 支持逗号或换行分隔的 `*`、`**`、`?` glob；被排除行不进入覆盖率分母，并会在报告中单独计数。

后续步骤可读取 `${{ steps.<action-step-id>.outputs.coverage }}`、`covered-lines`、`uncovered-lines`、`unmeasured-lines`、`excluded-lines`、`changed-files` 和 JSON `report`。如果工作流需要引用 outputs，请为 Action step 设置 `id`。

此仓库的 `.github/workflows/ci.yml` 会在 PR 上执行测试并用固定版本的 `c8` 生成 LCOV，随后上传短期保留的报告 artifact。`.github/workflows/pr-report.yml` 只在该 CI 成功结束后运行：它只检出可信任的 `main` 代码，验证触发 CI 的 PR head 仍是最新版本，再从**同一次 workflow run**下载 LCOV artifact 并更新 PR 报告。PR 运行本身只拥有只读权限；写评论权限仅存在于不执行 PR 代码的可信任报告工作流。

### 权限说明

工作流需要 `pull-requests: read` 读取文件变更、`issues: write` 创建或更新 PR 评论，以及 `contents: read` 检出代码。若不需要 PR 评论，可设置 `comment: "false"`，并在工作流权限策略允许时去掉 `issues: write`。

对来自 fork 的 PR，GitHub 通常会把 `GITHUB_TOKEN` 降为只读，因此评论步骤可能因权限不足而失败。若要先在 fork PR 上试用，可设 `comment: "false"` 查看 Job Summary；不要为了评论而在 `pull_request_target` 工作流中直接运行未经信任的 PR 代码。

## 本地运行测试

需要 Node.js 20 或更高版本：

```sh
npm test
```

## 当前边界与后续验证

- GitHub 文件列表 API 未提供 diff patch（例如过大的变更或二进制文件）时，会单独列出，不把未知情况误报成未覆盖。
- 只统计 LCOV 中明确记录的新增行；没有对应文件或行记录时标为“未测量”。
- 从 PR workflow 下载的 LCOV 被视为不可信输入；报告文件限制为 20 MiB 且必须是普通文件，可信任 workflow 不执行 artifact 内的代码。
- 可信任报告 workflow 会校验 artifact 来自触发它的同一 CI run、关联 PR head 仍未变化、且仅有一个不超过 20 MiB 的 LCOV artifact。
- 当多个 LCOV 文件都可能对应同一仓库路径时，不猜测映射，相关行标为“未测量”。
- 未覆盖代码行会作为 GitHub warning annotation 显示；GitHub 对 annotations 数量有限制，超大 PR 应结合 PR Summary 阅读完整结果。
- MVP 目前不自动判断业务风险、测试是否充分或代码是否正确。
- 上线前用真实仓库验证不同测试框架的 LCOV 路径格式、PR 文件数超过 100 的分页行为以及评论权限。
