// Cheap checks on uploaded receipt files, done on the bytes rather than trusting the
// client-declared content type.

export type ReceiptFileType = 'application/pdf' | 'image/png' | 'image/jpeg'

/** The file type from its leading bytes (magic numbers), or null if unrecognised. */
export function detectReceiptFileType(buffer: Buffer): ReceiptFileType | null {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf'
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  return null
}

/** Pixel dimensions of a PNG or JPEG from its header, or null when they can't be read. */
export function readImageDimensions(buffer: Buffer): { width: number; height: number } | null {
  const type = detectReceiptFileType(buffer)
  if (type === 'image/png') {
    // IHDR is always the first chunk: width and height are big-endian at bytes 16..23
    if (buffer.length < 24) return null
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (type === 'image/jpeg') {
    // Walk the segments to the first start-of-frame marker (SOF0..SOF15 except DHT/JPG/DAC)
    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) return null
      const marker = buffer[offset + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue }
      const length = buffer.readUInt16BE(offset + 2)
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isSof) return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
      offset += 2 + length
    }
  }
  return null
}

/**
 * Images larger than this are refused for OCR. A tiny compressed file can declare
 * enormous dimensions (a "decompression bomb") and exhaust memory in the image
 * tools. 60 MP comfortably covers phone photos of receipts.
 */
export const MAX_OCR_IMAGE_PIXELS = Number(process.env.RECEIPT_OCR_MAX_PIXELS ?? 60_000_000)

export function isImageTooLargeForOcr(buffer: Buffer): boolean {
  const dimensions = readImageDimensions(buffer)
  return dimensions !== null && dimensions.width * dimensions.height > MAX_OCR_IMAGE_PIXELS
}
