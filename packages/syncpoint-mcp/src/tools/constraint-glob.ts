/** Match a normalized resource path against the constraint glob syntax. */
export function matchesGlob(filePath: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "___DOUBLESTAR___")
    .replace(/\*/g, "[^/]*")
    .replace(/___DOUBLESTAR___/g, ".*")
    .replace(/\?/g, ".");
  try {
    return new RegExp(`^${regexStr}$`).test(filePath);
  } catch {
    return filePath.includes(pattern.replace(/\*\*/g, "").replace(/\*/g, ""));
  }
}
