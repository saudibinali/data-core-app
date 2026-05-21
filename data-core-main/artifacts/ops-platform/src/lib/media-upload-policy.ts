/** Client-side media upload rules (mirrors server branding policy). */

export const BRANDING_IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "svg",
  "webp",
  "gif",
  "ico",
  "bmp",
] as const;

export const BRANDING_LOGO_MAX_BYTES = 8 * 1024 * 1024;
export const BRANDING_FAVICON_MAX_BYTES = 2 * 1024 * 1024;

const EXT_RE = new RegExp(
  `\\.(${BRANDING_IMAGE_EXTENSIONS.join("|")})$`,
  "i",
);

export function brandingAcceptAttribute(kind: "logo" | "favicon"): string {
  return BRANDING_IMAGE_EXTENSIONS.map((e) => `.${e}`).join(",");
}

export function validateBrandingFile(
  file: File,
  kind: "logo" | "favicon",
): string | null {
  const max = kind === "logo" ? BRANDING_LOGO_MAX_BYTES : BRANDING_FAVICON_MAX_BYTES;
  if (file.size > max) {
    const mb = Math.round(max / (1024 * 1024));
    return `File is too large. Maximum size is ${mb} MB.`;
  }
  const name = file.name.toLowerCase();
  if (!EXT_RE.test(name)) {
    return `Unsupported format. Allowed: ${BRANDING_IMAGE_EXTENSIONS.join(", ")}.`;
  }
  if (file.type && !file.type.startsWith("image/") && file.type !== "application/octet-stream") {
    return "File must be an image.";
  }
  return null;
}
