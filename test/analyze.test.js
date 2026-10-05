import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeChanges,
  isBelowCoverageThreshold,
  parseAddedLines,
  parseExcludePatterns,
  parseLcov,
  renderGitHubAnnotations,
  renderMarkdown,
  shouldFailOnUnmeasured,
} from "../src/analyze.js";

test("parseAddedLines counts inserted lines and context, not deletions", () => {
  const patch = [
    "@@ -4,3 +4,4 @@",
    " context",
    "-old line",
    "+new line",
    "+another new line",
    " trailing context",
  ].join("\n");

  assert.deepEqual([...parseAddedLines(patch)], [5, 6]);
});

test("parseLcov merges repeated file records and preserves uncovered lines", () => {
  const lcov = [
    "TN:",
    "SF:src/example.js",
    "DA:10,0",
    "DA:11,1",
    "end_of_record",
    "SF:src/example.js",
    "DA:10,3",
    "end_of_record",
  ].join("\n");

  const coverage = parseLcov(lcov);
  assert.equal(coverage.get("src/example.js").get(10), 3);
  assert.equal(coverage.get("src/example.js").get(11), 1);
});

test("parseLcov rejects empty or malformed reports instead of returning success-shaped results", () => {
  assert.throws(() => parseLcov(""), /no source file records/);
  assert.throws(() => parseLcov("SF:src/example.js\nend_of_record"), /no line coverage entries/);
  assert.throws(() => parseLcov("SF:   \nDA:1,1"), /empty source file path/);
  assert.throws(
    () => parseLcov("SF:src/example.js\nDA:0,1\nend_of_record"),
    /invalid line coverage entry/,
  );
});

test("analyzeChanges distinguishes covered, uncovered, and unmeasured additions", () => {
  const changes = [
    {
      filename: "src/example.js",
      status: "modified",
      patch: ["@@ -1,2 +1,3 @@", " existing", "+covered", "+uncovered"].join("\n"),
    },
    {
      filename: "src/new.js",
      status: "added",
      patch: ["@@ -0,0 +1,2 @@", "+no report", "+no report either"].join("\n"),
    },
  ];
  const coverage = parseLcov(
    ["SF:/home/runner/work/repo/repo/src/example.js", "DA:2,5", "DA:3,0", "end_of_record"].join(
      "\n",
    ),
  );

  assert.deepEqual(analyzeChanges(changes, coverage), {
    covered: 1,
    uncovered: 1,
    unmeasured: 2,
    excluded: 0,
    changedFiles: 2,
    measuredCoverage: 50,
    filesWithoutPatch: [],
    filesWithoutCoverage: ["src/new.js"],
    excludedFiles: [],
    files: [
      {
        filename: "src/example.js",
        covered: 1,
        uncovered: 1,
        unmeasured: 0,
        changedLines: [2, 3],
        uncoveredLines: [3],
      },
      {
        filename: "src/new.js",
        covered: 0,
        uncovered: 0,
        unmeasured: 2,
        changedLines: [1, 2],
        uncoveredLines: [],
      },
    ],
  });
});

test("removed files are ignored and missing patches are reported", () => {
  const result = analyzeChanges(
    [
      { filename: "src/deleted.js", status: "removed" },
      { filename: "image.png", status: "added" },
    ],
    new Map(),
  );

  assert.deepEqual(result.filesWithoutPatch, ["image.png"]);
  assert.equal(result.covered + result.uncovered + result.unmeasured, 0);
  assert.equal(result.measuredCoverage, null);
});

test("renderMarkdown makes measured coverage and limitations explicit", () => {
  const markdown = renderMarkdown({
    covered: 3,
    uncovered: 1,
    unmeasured: 2,
    measuredCoverage: 75,
    files: [
      {
        filename: "src/file|name.js",
        covered: 3,
        uncovered: 1,
        unmeasured: 2,
      },
    ],
    filesWithoutPatch: ["assets/image.png"],
    filesWithoutCoverage: ["src/new.js"],
    excludedFiles: [],
  });

  assert.match(markdown, /\| 6 \| 4 \| 3 \| 1 \| 2 \| 75\.0% \|/);
  assert.match(markdown, /src\/file\\\|name\.js/);
  assert.match(markdown, /No matching coverage data/);
  assert.match(markdown, /Could not inspect diff patch/);
  assert.match(markdown, /Per-file results/);
});

test("coverage percentages retain one decimal place", () => {
  const markdown = renderMarkdown({
    covered: 1,
    uncovered: 2,
    unmeasured: 0,
    measuredCoverage: 100 / 3,
    files: [{ filename: "src/partial.js", covered: 1, uncovered: 2, unmeasured: 0 }],
    filesWithoutPatch: [],
    filesWithoutCoverage: [],
    excludedFiles: [],
  });

  assert.match(markdown, /\| 3 \| 3 \| 1 \| 2 \| 0 \| 33\.3% \|/);
  assert.match(markdown, /\| src\/partial\.js \| 1 \| 2 \| 0 \| 33\.3% \|/);
});

test("exclude path globs omit generated files and count excluded lines", () => {
  const patterns = parseExcludePatterns("**/*.generated.js,\ndocs/**");
  const result = analyzeChanges(
    [
      { filename: "src/api.generated.js", status: "modified", patch: "@@ -0,0 +1 @@\n+generated" },
      { filename: "docs/guide.md", status: "modified", patch: "@@ -0,0 +1 @@\n+docs" },
      { filename: "src/app.js", status: "modified", patch: "@@ -0,0 +1 @@\n+real" },
    ],
    new Map(),
    { excludePatterns: patterns },
  );

  assert.deepEqual(result.excludedFiles, ["src/api.generated.js", "docs/guide.md"]);
  assert.equal(result.excluded, 2);
  assert.equal(result.unmeasured, 1);
  assert.equal(result.changedFiles, 1);
});

test("minimum coverage threshold fails only when configured and measurable", () => {
  assert.equal(isBelowCoverageThreshold({ measuredCoverage: 79.9 }, 80), true);
  assert.equal(isBelowCoverageThreshold({ measuredCoverage: 80 }, 80), false);
  assert.equal(isBelowCoverageThreshold({ measuredCoverage: 90 }, null), false);
  assert.equal(isBelowCoverageThreshold({ measuredCoverage: null }, 0), true);
});

test("unmeasured added lines fail only when fail-on-unmeasured is enabled", () => {
  assert.equal(shouldFailOnUnmeasured({ unmeasured: 2 }, true), true);
  assert.equal(shouldFailOnUnmeasured({ unmeasured: 0 }, true), false);
  assert.equal(shouldFailOnUnmeasured({ unmeasured: 2 }, false), false);
});

test("renderGitHubAnnotations points to each uncovered changed line", () => {
  const annotations = renderGitHubAnnotations({
    files: [
      {
        filename: "src/a,b.js",
        changedLines: [4, 5, 6],
        uncoveredLines: [5, 6],
      },
    ],
  });
  assert.deepEqual(annotations, [
    "::warning file=src/a%2Cb.js,line=5,title=Changed line is not covered::No test execution was recorded for this added line.",
    "::warning file=src/a%2Cb.js,line=6,title=Changed line is not covered::No test execution was recorded for this added line.",
  ]);
});


test("parseLcov trims surrounding whitespace from source paths", () => {
  const coverage = parseLcov("SF: src/example.js \nDA:1,1\nend_of_record");
  assert.equal(coverage.has("src/example.js"), true);
});
