// Image-host client used by the workbench paste flow.
//
// The "图床设置" plugin owns the endpoint/token/autoUpload settings; this
// module turns one pasted image into a public URL. Uploads use a multipart
// POST with the file in the `file` field (a `Bearer` token when configured)
// and accept the common response shapes returned by image hosts.

const URL_KEYS = [
  "url",
  "link",
  "src",
  "path",
  "data.url",
  "data.link",
  "data.path",
  "data.src",
];

function lookup(payload, key) {
  let node = payload;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = node[part];
  }
  return node;
}

/**
 * Extracts a usable image URL from a host response. Plain text responses and
 * URL-shaped strings are accepted as-is; JSON responses are searched for the
 * common keys above.
 */
export function extractImageUrl(payload) {
  if (typeof payload === "string") {
    const text = payload.trim();
    if (/^https?:\/\//i.test(text) || text.startsWith("/")) return text;
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  for (const key of URL_KEYS) {
    const value = lookup(payload, key);
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

/**
 * Uploads `file` to `endpoint` and resolves the public URL. Throws on HTTP
 * errors, timeouts and responses without a recognisable URL.
 */
export async function uploadImage({
  endpoint,
  token = "",
  file,
  field = "file",
  timeoutMs = 15000,
  fetchImpl = fetch,
  FormDataImpl = FormData,
}) {
  if (!endpoint) throw new Error("未配置上传地址");
  const form = new FormDataImpl();
  form.append(field, file, file.name || "image.png");
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      body: form,
      headers,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    let payload = text;
    try {
      payload = JSON.parse(text);
    } catch {
      /* keep plain text */
    }
    const url = extractImageUrl(payload);
    if (!url) throw new Error("图床响应中没有图片 URL");
    return url;
  } finally {
    clearTimeout(timer);
  }
}
