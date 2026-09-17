export function parseOutline(source) {
  const entries = [];
  const lines = source.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(=+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const title = match[2].trim().replace(/\s+<[^<>]*>\s*$/, "").trim();
    entries.push({ level: match[1].length, title, line: i + 1 });
  }
  return entries;
}
