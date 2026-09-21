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

/**
 * Turns an OSS error response into an actionable message (parses the XML
 * `<Code>`/`<Message>` fields and maps common HTTP statuses to hints).
 */
export async function describeOssError(response) {
  let code = "";
  let message = "";
  try {
    const text = await response.text();
    code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? "";
    message = /<Message>([^<]+)<\/Message>/.exec(text)?.[1] ?? "";
  } catch {
    /* ignore body errors */
  }
  const base = `OSS HTTP ${response.status}${code ? ` ${code}` : ""}${message ? `：${message}` : ""}`;
  if (response.status === 405) {
    return `${base}（PUT 被目标地址拒绝：请确认 Endpoint 是 OSS 访问域名，如 https://<bucket>.oss-cn-<region>.aliyuncs.com，而不是 CDN/自定义域名；或在“云端上传方式”选择“阿里云 OSS 表单直传（POST）”；Bucket 跨域设置的允许 Methods 需包含 PUT/POST）`;
  }
  if (response.status === 403) {
    return `${base}（检查 RAM 是否授予 oss:PutObject、AccessKeyId/Secret 是否属于该 Bucket、Bucket 跨域是否允许本站来源）`;
  }
  if (response.status === 400) {
    return `${base}（检查 Bucket/Endpoint 区域是否一致、对象前缀是否合法）`;
  }
  return base;
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
 * Where pasted images go by default: "cloud" or "local". The first option
 * of the settings select ("cloud") is also the default for unset values, so
 * a fresh install prefers the image host and falls back with a reason when
 * the host is not configured yet.
 */
export function pasteTargetOf(settings = {}) {
  return settings.pasteTarget === "local" ? "local" : "cloud";
}

/**
 * Whether the settings are complete enough for a cloud upload.
 * Returns `{ ok, reason }` so the host can explain why it fell back.
 */
export function cloudUploadReady(settings = {}) {
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
      throw new Error(await describeOssError(response));
    }
    return buildPublicUrl(settings, key);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Aliyun OSS form upload (PostObject). Works when PUT is blocked (CDN in
 * front, restrictive CORS) because the form is a simple request signed by a
 * policy instead of the Authorization header.
 */
export async function uploadToAliyunOssPost(
  settings,
  file,
  { fetchImpl = fetch, timeoutMs = 30000, now = new Date(), FormDataImpl = FormData } = {},
) {
  const { endpoint, accessKeyId, accessKeySecret } = settings;
  const prefix = String(settings.prefix ?? "typstbit/").replace(/^\/+/, "");
  const key = settings.objectKey ?? buildObjectKey(prefix, file, now);
  const policy = base64Encode(
    new TextEncoder().encode(
      JSON.stringify({
        expiration: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
        conditions: [
          ["content-length-range", 0, 32 * 1024 * 1024],
          ["starts-with", "$key", prefix],
        ],
      }),
    ),
  );
  const signature = await hmacSha1Base64(accessKeySecret, policy);
  const form = new FormDataImpl();
  form.append("key", key);
  form.append("policy", policy);
  form.append("OSSAccessKeyId", accessKeyId);
  form.append("signature", signature);
  form.append("success_action_status", "200");
  if (file.type) form.append("Content-Type", file.type);
  form.append("file", file, file.name || "image.png");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(trimSlash(endpoint), {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(await describeOssError(response));
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
    if ((settings.uploadMethod ?? "put") === "post") {
      return uploadToAliyunOssPost(settings, file, overrides);
    }
    return uploadToAliyunOss(settings, file, overrides);
  }
  return uploadMultipart(settings, file, overrides);
}
