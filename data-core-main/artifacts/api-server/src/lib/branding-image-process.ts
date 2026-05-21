/**
 * Optional raster optimization for branding uploads (requires sharp).
 */
import path from "node:path";

const RASTER_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp"]);

export function isRasterExtension(ext: string): boolean {
  return RASTER_EXT.has(ext.replace(/^\./, "").toLowerCase());
}

export async function processBrandingImage(
  buffer: Buffer,
  originalFileName: string,
  kind: "logo" | "favicon",
): Promise<{ buffer: Buffer; ext: string }> {
  const ext = path.extname(originalFileName).toLowerCase() || (kind === "favicon" ? ".ico" : ".png");
  const extKey = ext.replace(/^\./, "");

  if (!isRasterExtension(ext)) {
    return { buffer, ext };
  }

  try {
    const sharp = (await import("sharp")).default;
    const maxDim = kind === "favicon" ? 128 : 512;
    let pipeline = sharp(buffer, { failOn: "none" }).rotate();

    const meta = await pipeline.metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w > maxDim || h > maxDim) {
      pipeline = pipeline.resize(maxDim, maxDim, { fit: "inside", withoutEnlargement: true });
    }

    if (extKey === "jpg" || extKey === "jpeg") {
      const out = await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
      return { buffer: out, ext: ".jpg" };
    }
    if (extKey === "webp") {
      const out = await pipeline.webp({ quality: 85 }).toBuffer();
      return { buffer: out, ext: ".webp" };
    }
    if (extKey === "png") {
      const out = await pipeline.png({ compressionLevel: 9 }).toBuffer();
      return { buffer: out, ext: ".png" };
    }
    if (extKey === "gif") {
      const out = await pipeline.gif().toBuffer();
      return { buffer: out, ext: ".gif" };
    }
    if (extKey === "bmp") {
      const out = await pipeline.png({ compressionLevel: 9 }).toBuffer();
      return { buffer: out, ext: ".png" };
    }

    const out = await pipeline.png({ compressionLevel: 9 }).toBuffer();
    return { buffer: out, ext: ".png" };
  } catch {
    return { buffer, ext };
  }
}
