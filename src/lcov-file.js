import { lstat, readFile } from "node:fs/promises";

export const MAX_LCOV_BYTES = 20 * 1024 * 1024;

export async function readLcovFile(path) {
  const metadata = await lstat(path);
  if (!metadata.isFile()) {
    throw new Error("The LCOV report must be a regular file, not a directory or symbolic link.");
  }
  if (metadata.size > MAX_LCOV_BYTES) {
    throw new Error("The LCOV report exceeds the 20 MiB safety limit.");
  }
  return readFile(path, "utf8");
}
