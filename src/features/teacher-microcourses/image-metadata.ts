import "server-only";

/** Deliberately narrow parser for the image formats accepted by the author UI. */
export function teacherImageDimensions(
  bytes: Uint8Array,
  mime: string,
): { width: number; height: number } | null {
  const read16 = (offset: number) => (bytes[offset]! << 8) | bytes[offset + 1]!;
  if (mime === "image/png" && bytes.length >= 24) {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (signature.every((value, index) => bytes[index] === value)) {
      return {
        width: ((bytes[16]! << 24) | (bytes[17]! << 16) | (bytes[18]! << 8) | bytes[19]!) >>> 0,
        height: ((bytes[20]! << 24) | (bytes[21]! << 16) | (bytes[22]! << 8) | bytes[23]!) >>> 0,
      };
    }
  }
  if (mime === "image/gif" && bytes.length >= 10) {
    const header = String.fromCharCode(...bytes.slice(0, 6));
    if (header === "GIF87a" || header === "GIF89a") {
      return {
        width: bytes[6]! | (bytes[7]! << 8),
        height: bytes[8]! | (bytes[9]! << 8),
      };
    }
  }
  if (mime === "image/jpeg" && bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let offset = 2; offset + 9 < bytes.length;) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1]!;
      const length = read16(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: read16(offset + 7), height: read16(offset + 5) };
      }
      if (length < 2) break;
      offset += length + 2;
    }
  }
  if (
    mime === "image/webp"
    && bytes.length >= 30
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === "VP8X") {
      return {
        width: 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16),
        height: 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16),
      };
    }
    if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return {
        width: (bytes[26]! + (bytes[27]! << 8)) & 0x3fff,
        height: (bytes[28]! + (bytes[29]! << 8)) & 0x3fff,
      };
    }
    if (chunk === "VP8L" && bytes[20] === 0x2f) {
      return {
        width: 1 + bytes[21]! + ((bytes[22]! & 0x3f) << 8),
        height: 1 + (bytes[22]! >> 6) + (bytes[23]! << 2) + ((bytes[24]! & 0x0f) << 10),
      };
    }
  }
  return null;
}
