const MANIFEST_URL = new URL("./packages/manifest.json", import.meta.url);

export async function loadPackageManifest() {
  const response = await fetch(MANIFEST_URL);
  if (!response.ok) throw new Error(`package manifest: ${response.status}`);
  const data = await response.json();
  return Array.isArray(data.packages) ? data.packages : [];
}

export function packageSpecsInSource(source) {
  const specs = new Set();
  const pattern = /@([a-z0-9-]+)\/([a-z0-9-]+):(\d+\.\d+\.\d+)/g;
  for (const match of source.matchAll(pattern)) {
    specs.add(`@${match[1]}/${match[2]}:${match[3]}`);
  }
  return [...specs];
}

export async function registerPackage(bridge, entry) {
  const base = new URL(`./packages/${entry.root}/`, import.meta.url);
  const fetched = await Promise.all(
    entry.files.map(async file => {
      const response = await fetch(new URL(file, base));
      if (!response.ok) throw new Error(`${entry.spec}/${file}: ${response.status}`);
      return { file, bytes: new Uint8Array(await response.arrayBuffer()) };
    }),
  );
  for (const { file, bytes } of fetched) {
    const status = bridge.setPackageFile(entry.spec, file, bytes);
    if (status !== 0) throw new Error(`${entry.spec}/${file}: ABI status ${status}`);
  }
}
