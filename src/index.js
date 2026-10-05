import { appendFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { readLcovFile } from "./lcov-file.js";
import {
  analyzeChanges,
  isBelowCoverageThreshold,
  parseExcludePatterns,
  parseLcov,
  renderGitHubAnnotations,
  renderMarkdown,
  shouldFailOnUnmeasured,
} from "./analyze.js";

const token = requiredEnv("INPUT_GITHUB_TOKEN");
const lcovPath = resolve(requiredEnv("INPUT_LCOV_FILE"));
const eventPath = requiredEnv("GITHUB_EVENT_PATH");
const repository = requiredEnv("GITHUB_REPOSITORY");
const minimumCoverage = parseMinimumCoverage(process.env.INPUT_MIN_COVERAGE ?? "");
const excludePatterns = parseExcludePatterns(process.env.INPUT_EXCLUDE_PATHS ?? "");
const event = JSON.parse(await readFile(eventPath, "utf8"));
const requestedPullNumber = process.env.INPUT_PR_NUMBER?.trim();
const pullRequestNumber = event.pull_request?.number
  ?? (requestedPullNumber ? Number(requestedPullNumber) : null);

if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1) {
  throw new Error("A valid pull request number is required from a pull_request event or pr-number input.");
}

const [lcovContent, changes] = await Promise.all([
  readLcovFile(lcovPath),
  getPullRequestFiles(repository, pullRequestNumber, token),
]);

const result = analyzeChanges(changes, parseLcov(lcovContent), { excludePatterns });
const markdown = renderMarkdown(result);
for (const annotation of renderGitHubAnnotations(result)) console.log(annotation);
await writeStepSummary(markdown);
await writeOutputs(result);

if (process.env.INPUT_COMMENT !== "false") {
  await upsertPullRequestComment(repository, pullRequestNumber, token, markdown);
}

if (process.env.INPUT_FAIL_ON_UNCOVERED === "true" && result.uncovered > 0) {
  console.error(`Found ${result.uncovered} changed line(s) without test coverage.`);
  process.exitCode = 1;
}

if (shouldFailOnUnmeasured(result, process.env.INPUT_FAIL_ON_UNMEASURED === "true")) {
  console.error(`Found ${result.unmeasured} changed line(s) without matching coverage data.`);
  process.exitCode = 1;
}

if (isBelowCoverageThreshold(result, minimumCoverage)) {
  const actual = result.measuredCoverage === null
    ? "no measurable changed lines"
    : `${result.measuredCoverage.toFixed(1)}%`;
  console.error(`Changed-line coverage ${actual} is below the configured ${minimumCoverage}% threshold.`);
  process.exitCode = 1;
}

async function getPullRequestFiles(repositoryName, number, githubToken) {
  const files = [];
  for (let page = 1; ; page += 1) {
    const response = await githubRequest(
      `/repos/${repositoryName}/pulls/${number}/files?per_page=100&page=${page}`,
      githubToken,
    );
    if (!Array.isArray(response)) {
      throw new Error("GitHub returned an unexpected pull request files response.");
    }
    files.push(...response);
    if (response.length < 100) return files;
  }
}

async function upsertPullRequestComment(repositoryName, number, githubToken, body) {
  const comments = [];
  for (let page = 1; ; page += 1) {
    const response = await githubRequest(
      `/repos/${repositoryName}/issues/${number}/comments?per_page=100&page=${page}`,
      githubToken,
    );
    if (!Array.isArray(response)) {
      throw new Error("GitHub returned an unexpected pull request comments response.");
    }
    comments.push(...response);
    if (response.length < 100) break;
  }

  const existing = comments.find(
    (comment) =>
      comment.user?.login === "github-actions[bot]" &&
      comment.body?.includes("<!-- pr-change-verifier -->"),
  );
  const endpoint = existing
    ? `/repos/${repositoryName}/issues/comments/${existing.id}`
    : `/repos/${repositoryName}/issues/${number}/comments`;
  await githubRequest(endpoint, githubToken, {
    method: existing ? "PATCH" : "POST",
    body: JSON.stringify({ body }),
  });
}

async function githubRequest(path, githubToken, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub API request failed (${response.status}): ${detail}`);
  }
  return response.status === 204 ? null : response.json();
}

async function writeStepSummary(markdown) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) await appendFile(summaryPath, `${markdown}\n`, "utf8");
}

async function writeOutputs(result) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const outputs = {
    "covered-lines": result.covered,
    "uncovered-lines": result.uncovered,
    "unmeasured-lines": result.unmeasured,
    "excluded-lines": result.excluded,
    "changed-files": result.changedFiles,
    coverage: result.measuredCoverage ?? "n/a",
    report: JSON.stringify(result),
  };
  const output = Object.entries(outputs)
    .map(([name, value]) => {
      const text = String(value);
      let delimiter;
      do {
        delimiter = `ghadelimiter_${randomUUID()}`;
      } while (text.includes(delimiter));
      return `${name}<<${delimiter}\n${text}\n${delimiter}`;
    })
    .join("\n");
  await appendFile(outputPath, `${output}\n`, "utf8");
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable ${name} is missing.`);
  return value;
}

function parseMinimumCoverage(value) {
  if (value.trim() === "") return null;
  const threshold = Number(value);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new Error("INPUT_MIN_COVERAGE must be a number between 0 and 100.");
  }
  return threshold;
}
