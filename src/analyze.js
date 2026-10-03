export function parseLcov(content) {
  const files = new Map();
  let currentFile = null;
  let coverageEntries = 0;

  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      currentFile = normalizePath(line.slice(3));
      if (!currentFile) throw new Error("LCOV contains an empty source file path.");
      if (!files.has(currentFile)) files.set(currentFile, new Map());
      continue;
    }

    if (line === "end_of_record") {
      currentFile = null;
      continue;
    }

    if (!currentFile || !line.startsWith("DA:")) continue;

    const [lineNumberText, hitCountText] = line.slice(3).split(",");
    const lineNumber = Number(lineNumberText);
    const hitCount = Number(hitCountText);
    if (!Number.isInteger(lineNumber) || lineNumber < 1 || !Number.isFinite(hitCount) || hitCount < 0) {
      throw new Error(`LCOV contains an invalid line coverage entry: ${line}`);
    }

    const lineHits = files.get(currentFile);
    lineHits.set(lineNumber, Math.max(lineHits.get(lineNumber) ?? 0, hitCount));
    coverageEntries += 1;
  }

  if (files.size === 0) throw new Error("LCOV report contains no source file records (SF:).");
  if (coverageEntries === 0) throw new Error("LCOV report contains no line coverage entries (DA:).");

  return files;
}

export function parseAddedLines(patch) {
  const addedLines = new Set();
  let currentLine = null;

  for (const line of patch.split(/\r?\n/)) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      currentLine = Number(hunk[1]);
      continue;
    }

    if (currentLine === null || line.startsWith("\\ No newline")) continue;

    if (line.startsWith("+") && !line.startsWith("+++")) {
      addedLines.add(currentLine);
      currentLine += 1;
    } else if (!line.startsWith("-")) {
      currentLine += 1;
    }
  }

  return addedLines;
}

export function analyzeChanges(changes, coverage, options = {}) {
  const result = {
    covered: 0,
    uncovered: 0,
    unmeasured: 0,
    excluded: 0,
    changedFiles: 0,
    measuredCoverage: null,
    files: [],
    filesWithoutPatch: [],
    filesWithoutCoverage: [],
    excludedFiles: [],
  };

  for (const change of changes) {
    if (change.status === "removed") continue;
    const excluded = isExcluded(change.filename, options.excludePatterns ?? []);
    if (excluded) {
      result.excludedFiles.push(change.filename);
    }
    if (!change.patch) {
      if (excluded) continue;
      result.filesWithoutPatch.push(change.filename);
      continue;
    }

    const addedLines = parseAddedLines(change.patch);
    if (excluded) {
      result.excluded += addedLines.size;
      continue;
    }
    if (addedLines.size === 0) continue;

    result.changedFiles += 1;
    const fileResult = {
      filename: change.filename,
      covered: 0,
      uncovered: 0,
      unmeasured: 0,
      changedLines: [...addedLines].sort((a, b) => a - b),
      uncoveredLines: [],
    };
    const sourceFile = findCoverageFile(change.filename, coverage);
    if (!sourceFile) {
      result.unmeasured += addedLines.size;
      fileResult.unmeasured = addedLines.size;
      result.filesWithoutCoverage.push(change.filename);
      result.files.push(fileResult);
      continue;
    }

    const lineHits = coverage.get(sourceFile);
    for (const lineNumber of addedLines) {
      if (!lineHits.has(lineNumber)) {
        result.unmeasured += 1;
        fileResult.unmeasured += 1;
      } else if (lineHits.get(lineNumber) > 0) {
        result.covered += 1;
        fileResult.covered += 1;
      } else {
        result.uncovered += 1;
        fileResult.uncovered += 1;
        fileResult.uncoveredLines.push(lineNumber);
      }
    }
    result.files.push(fileResult);
  }

  const measured = result.covered + result.uncovered;
  if (measured > 0) result.measuredCoverage = (result.covered / measured) * 100;
  return result;
}

export function renderMarkdown(result) {
  const coverage = result.measuredCoverage === null
    ? "N/A"
    : `${Math.round(result.measuredCoverage)}%`;
  const lines = [
    "<!-- pr-change-verifier -->",
    "## PR change verification",
    "",
    "| Changed lines | Covered | Uncovered | Not measured | Changed-line coverage |",
    "| ---: | ---: | ---: | ---: | ---: |",
    `| ${result.covered + result.uncovered + result.unmeasured} | ${result.covered} | ${result.uncovered} | ${result.unmeasured} | ${coverage} |`,
    "",
    "Coverage is based on the supplied LCOV report and only counts added lines with recorded coverage data.",
  ];

  if (result.files.length > 0) {
    lines.push(
      "",
      "<details>",
      `<summary>Per-file results (${result.files.length} files)</summary>`,
      "",
      "| File | Covered | Uncovered | Not measured | Coverage |",
      "| --- | ---: | ---: | ---: | ---: |",
      ...result.files.map((file) => {
        const fileMeasured = file.covered + file.uncovered;
        const fileCoverage = fileMeasured === 0
          ? "N/A"
          : `${Math.round((file.covered / fileMeasured) * 100)}%`;
        return `| ${escapeTableCell(file.filename)} | ${file.covered} | ${file.uncovered} | ${file.unmeasured} | ${fileCoverage} |`;
      }),
      "",
      "</details>",
    );
  }

  if (result.excludedFiles.length > 0) {
    lines.push(
      "",
      `**Excluded changed lines:** ${result.excluded} across ${result.excludedFiles.length} file(s): ${formatFiles(result.excludedFiles)}`,
    );
  }
  if (result.filesWithoutCoverage.length > 0) {
    lines.push("", `**No matching coverage data:** ${formatFiles(result.filesWithoutCoverage)}`);
  }
  if (result.filesWithoutPatch.length > 0) {
    lines.push("", `**Could not inspect diff patch:** ${formatFiles(result.filesWithoutPatch)}`);
  }

  return lines.join("\n");
}

export function parseExcludePatterns(value = "") {
  return value
    .split(/[\r\n,]+/)
    .map((pattern) => normalizePath(pattern.trim()))
    .filter(Boolean);
}

export function isBelowCoverageThreshold(result, threshold) {
  if (threshold === null) return false;
  return result.measuredCoverage === null || result.measuredCoverage < threshold;
}

export function renderGitHubAnnotations(result) {
  return result.files.flatMap((file) =>
    file.changedLines
      .filter((line) => file.uncoveredLines.includes(line))
      .map(
        (line) =>
          `::warning file=${escapeAnnotation(file.filename)},line=${line},title=Changed line is not covered::No test execution was recorded for this added line.`,
      ),
  );
}

function findCoverageFile(filename, coverage) {
  const normalizedFilename = normalizePath(filename);
  const exactMatch = coverage.has(normalizedFilename) ? normalizedFilename : null;
  if (exactMatch) return exactMatch;

  const suffixMatches = [...coverage.keys()].filter(
    (sourceFile) => sourceFile.endsWith(`/${normalizedFilename}`),
  );
  return suffixMatches.length === 1 ? suffixMatches[0] : null;
}

function isExcluded(filename, patterns) {
  const normalizedFilename = normalizePath(filename);
  return patterns.some((pattern) => globToRegExp(pattern).test(normalizedFilename));
}

function globToRegExp(glob) {
  let expression = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === "*" && glob[index + 1] === "*") {
      index += 1;
      if (glob[index + 1] === "/") {
        index += 1;
        expression += "(?:.*/)?";
      } else {
        expression += ".*";
      }
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${expression}$`);
}

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function formatFiles(files) {
  return files.map((file) => `\`${file.replaceAll("`", "\\`")}\``).join(", ");
}

function escapeTableCell(value) {
  return value.replaceAll("|", "\\|").replaceAll("`", "\\`").replace(/[\r\n]/g, " ");
}

function escapeAnnotation(value) {
  return value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")
    .replaceAll(",", "%2C");
}
