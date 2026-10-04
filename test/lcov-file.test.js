import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_LCOV_BYTES, readLcovFile } from "../src/lcov-file.js";

test("readLcovFile reads a regular report", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pr-change-verifier-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "lcov.info");
  await writeFile(file, "SF:src/app.js\nDA:1,1\nend_of_record");

  assert.equal(await readLcovFile(file), "SF:src/app.js\nDA:1,1\nend_of_record");
});

test("readLcovFile rejects directories and reports over the size limit", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pr-change-verifier-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const oversizedFile = join(directory, "oversized.info");
  await writeFile(oversizedFile, Buffer.alloc(MAX_LCOV_BYTES + 1));

  await assert.rejects(readLcovFile(directory), /regular file/);
  await assert.rejects(readLcovFile(oversizedFile), /20 MiB safety limit/);
});
