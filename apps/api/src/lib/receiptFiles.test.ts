import { describe, expect, it } from 'vitest'
import { detectReceiptFileType, isImageTooLargeForOcr, readImageDimensions } from './receiptFiles'

function png(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0)
  buffer.writeUInt32BE(13, 8)
  buffer.write('IHDR', 12, 'latin1')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

function jpeg(width: number, height: number): Buffer {
  // SOI, APP0 (length 16), SOF0 with height/width
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14)])
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03])
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(10)])
}

describe('detectReceiptFileType', () => {
  it('recognises PDF, PNG and JPEG by their bytes', () => {
    expect(detectReceiptFileType(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf')
    expect(detectReceiptFileType(png(10, 10))).toBe('image/png')
    expect(detectReceiptFileType(jpeg(10, 10))).toBe('image/jpeg')
  })

  it('rejects anything else, whatever the declared type', () => {
    expect(detectReceiptFileType(Buffer.from('<html><script>alert(1)</script>'))).toBeNull()
    expect(detectReceiptFileType(Buffer.alloc(0))).toBeNull()
  })
})

describe('image dimensions', () => {
  it('reads PNG and JPEG headers', () => {
    expect(readImageDimensions(png(3024, 4032))).toEqual({ width: 3024, height: 4032 })
    expect(readImageDimensions(jpeg(1200, 1600))).toEqual({ width: 1200, height: 1600 })
  })

  it('flags decompression bombs', () => {
    expect(isImageTooLargeForOcr(png(3024, 4032))).toBe(false)
    expect(isImageTooLargeForOcr(png(50_000, 50_000))).toBe(true)
  })
})
