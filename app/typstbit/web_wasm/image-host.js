// Image-host client used by the workbench paste flow.
//
// Two providers:
//   - "aliyun-oss" (default): PutObject with an OSS V1 signature
//     (`Authorization: OSS <AccessKeyId>:<base64(HMAC-SHA1)>`), optionally
//     returning a custom domain URL. The bucket must allow CORS from the
//     page origin for PUT with the Date/Authorization headers.
//   - "multipart": generic POST with the file in the `file` field and an
//     optional `Bearer` token, accepting the common URL response shapes.
//
// The AccessKeySecret is stored in localStorage (this is a local-first,
// single-user tool); use a dedicated OSS account or STS credentials.

function base64Encode(bytes) {
  if (typeof globalThis.btoa === "function") {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return globalThis.btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
}

function trimSlash(url) {
  return String(url ?? "").replace(/\/+$/, "");
}

function encodeKey(key) {
  return key
    .split("/")
    .map(segment => encodeURIComponent(segment))
    .join("/");
}

function fileExtension(file) {
  const name = file?.name ?? "";
  const dot = name.lastIndexOf(".");
  let ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (!ext) {
    ext = file?.type === "image/jpeg" ? "jpg" : file?.type === "image/svg+xml" ? "svg" : "png";
  }
  ext = ext.replace(/[^a-z0-9]/g, "");
  return ext || "png";
}

/**
 * HMAC-SHA1 as base64 (OSS signature). Works in browsers and Node 18+.
 */
export async function hmacSha1Base64(secret, message) {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return base64Encode(new Uint8Array(signature));
}

/**
 * OSS V1 string-to-sign: `METHOD\nContent-MD5\nContent-Type\nDate\n/Bucket/Key`.
 */
export function aliyunStringToSign({ method = "PUT", contentType = "", date, bucket, key }) {
  return `${method}\n\n${contentType}\n${date}\n/${bucket}/${key}`;
}

/**
 * Upload object key: `<prefix><yyyymmdd>-<base36 time>-<random>.<ext>`.
 */
export function buildObjectKey(prefix = "typstbit/", file, now = new Date()) {
  const clean = String(prefix ?? "").replace(/^\/+/, "");
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  const random = Math.random().toString(36).slice(2, 8);
  return `${clean}${stamp}-${Date.now().toString(36)}-${random}.${fileExtension(file)}`;
}

/**
 * Public URL for an uploaded key (custom domain wins over the endpoint).
 */
export function buildPublicUrl(settings, key) {
  const base = trimSlash(settings.customDomain || settings.endpoint);
  if (!base) return key;
  return `${base}/${encodeKey(key)}`;
}

/**
 * Whether the settings are complete enough for automatic upload.
 * Returns `{ ok, reason }` so the host can explain why it fell back.
 */
export function autoUploadReady(settings = {}) {
  if (!settings.autoUpload) return { ok: false, reason: "未开启自动上传" };
  const provider = settings.provider ?? "aliyun-oss";
  if (provider === "aliyun-oss") {
    if (!settings.endpoint) return { ok: false, reason: "未配置 OSS Endpoint" };
    if (!settings.bucket) return { ok: false, reason: "未配置 Bucket" };
    if (!settings.accessKeyId || !settings.accessKeySecret) {
      return { ok: false, reason: "未配置 AccessKeyId/AccessKeySecret" };
    }
    return { ok: true, reason: "" };
  }
  if (!settings.endpoint) return { ok: false, reason: "未配置上传地址" };
  return { ok: true, reason: "" };
}

/**
 * Uploads `file` to Aliyun OSS and resolves the public URL.
 */
export async function uploadToAliyunOss(
  settings,
  file,
  { fetchImpl = fetch, timeoutMs = 30000, now = new Date() } = {},
) {
  const { endpoint, bucket, accessKeyId, accessKeySecret } = settings;
  const contentType = file.type || "application/octet-stream";
  const key = settings.objectKey ?? buildObjectKey(settings.prefix ?? "typstbit/", file, now);
  const date = now.toUTCString();
  const signature = await hmacSha1Base64(
    accessKeySecret,
    aliyunStringToSign({ method: "PUT", contentType, date, bucket, key }),
  );
  const url = `${trimSlash(endpoint)}/${encodeKey(key)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "PUT",
      headers: {
        Date: date,
        "Content-Type": contentType,
        Authorization: `OSS ${accessKeyId}:${signature}`,
      },
      body: file,
      signal: controller.signal,
    });
    if (!response.ok) {
      let detail = "";
      try {
        const text = await response.text();
        detail = /<Message>([^<]+)<\/Message>/.exec(text)?.[1] ?? "";
      } catch {
        /* ignore body errors */
      }
      throw new Error(`OSS HTTP ${response.status}${detail ? `：${detail}` : ""}`);
    }
    return buildPublicUrl(settings, key);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extracts a usable image URL from a multipart host response. Plain text
 * responses and URL-shaped strings are accepted as-is; JSON responses are
 * searched for the common keys below.
 */
export function extractImageUrl(payload) {
  const keys = [
    "url",
    "link",
    "src",
    "path",
    "data.url",
    "data.link",
    "data.path",
    "data.src",
  ];
  if (typeof payload === "string") {
    const text = payload.trim();
    if (/^https?:\/\//i.test(text) || text.startsWith("/")) return text;
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  for (const key of keys) {
    let node = payload;
    for (const part of key.split(".")) {
      if (!node || typeof node !== "object") {
        node = undefined;
        break;
      }
      node = node[part];
    }
    if (typeof node === "string" && node.length > 0) return node;
  }
  return null;
}

/**
 * Generic multipart upload (custom image host).
 */
export async function uploadMultipart(
  { endpoint, token = "", field = "file" },
  file,
  { fetchImpl = fetch, timeoutMs = 15000, FormDataImpl = FormData } = {},
) {
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

/**
 * Dispatches to the configured provider.
 */
export function uploadImage(settings, file, overrides = {}) {
  const provider = settings.provider ?? "aliyun-oss";
  if (provider === "aliyun-oss") {
    return uploadToAliyunOss(settings, file, overrides);
  }
  return uploadMultipart(settings, file, overrides);
}
