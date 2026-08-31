/**
 * Generates the PWA icons.
 *
 * iOS only accepts a PNG for `apple-touch-icon`, and the acceptance criteria
 * include installing the site on iOS, so the icons cannot be SVG. Rather than
 * committing opaque binaries produced elsewhere, they are drawn here from a
 * pixel buffer and encoded with `node:zlib` alone: no dependency, and the
 * result is reproducible from readable code.
 *
 * The mark is three bars of decreasing width, echoing the three criticality
 * sections of the site.
 */

import { deflateSync } from 'node:zlib';

import { writeFileSync } from 'node:fs';

import { ensureDirectory } from '../shared/jsonStore';
import { createLogger } from '../shared/logger';
import { PATHS } from '../shared/paths';
import { join } from 'node:path';

const logger = createLogger(import.meta.url);

const CHANNELS = 4;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface Colour {
  red: number;
  green: number;
  blue: number;
}

const BACKGROUND: Colour = { red: 0x10, green: 0x13, blue: 0x1a };
const BAR_COLOURS: readonly Colour[] = [
  { red: 0xff, green: 0x5c, blue: 0x5c },
  { red: 0xff, green: 0xb2, blue: 0x24 },
  { red: 0x5b, green: 0x8d, blue: 0xef },
];

const ICON_SIZES = [180, 192, 512] as const;

/** CRC-32, as required by every PNG chunk. */
const buildCrcTable = (): Uint32Array => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
};

const CRC_TABLE = buildCrcTable();

const computeCrc32 = (data: Buffer): number => {
  let crc = 0xffffffff;

  for (const byte of data) {
    const index = (crc ^ byte) & 0xff;
    crc = ((CRC_TABLE[index] ?? 0) ^ (crc >>> 8)) >>> 0;
  }

  return (crc ^ 0xffffffff) >>> 0;
};

const buildChunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(computeCrc32(typeAndData), 0);

  return Buffer.concat([length, typeAndData, crc]);
};

/** Encodes an RGBA buffer as a PNG. */
const encodePng = (width: number, height: number, pixels: Buffer): Buffer => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(6, 9);
  header.writeUInt8(0, 10);
  header.writeUInt8(0, 11);
  header.writeUInt8(0, 12);

  // Each scanline is prefixed by its filter type, here always zero.
  const stride = width * CHANNELS;
  const raw = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    buildChunk('IHDR', header),
    buildChunk('IDAT', deflateSync(raw, { level: 9 })),
    buildChunk('IEND', Buffer.alloc(0)),
  ]);
};

/** Tells whether a point sits inside a rounded rectangle. */
const isInsideRoundedRect = (
  x: number,
  y: number,
  left: number,
  top: number,
  width: number,
  height: number,
  radius: number,
): boolean => {
  if (x < left || y < top || x >= left + width || y >= top + height) {
    return false;
  }

  const insetLeft = left + radius;
  const insetRight = left + width - radius;
  const insetTop = top + radius;
  const insetBottom = top + height - radius;

  if (x >= insetLeft && x <= insetRight) {
    return true;
  }

  if (y >= insetTop && y <= insetBottom) {
    return true;
  }

  const cornerX = x < insetLeft ? insetLeft : insetRight;
  const cornerY = y < insetTop ? insetTop : insetBottom;
  const deltaX = x - cornerX;
  const deltaY = y - cornerY;

  return deltaX * deltaX + deltaY * deltaY <= radius * radius;
};

const drawIcon = (size: number): Buffer => {
  const pixels = Buffer.alloc(size * size * CHANNELS);
  const barHeight = Math.round(size * 0.1);
  const barRadius = barHeight / 2;
  const gap = Math.round(size * 0.075);
  const totalHeight = barHeight * 3 + gap * 2;
  const firstTop = Math.round((size - totalHeight) / 2);
  const widths = [0.62, 0.46, 0.3].map((ratio) => Math.round(size * ratio));
  const left = Math.round(size * 0.19);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let colour = BACKGROUND;

      for (let barIndex = 0; barIndex < 3; barIndex += 1) {
        const top = firstTop + barIndex * (barHeight + gap);
        const width = widths[barIndex] ?? 0;
        const barColour = BAR_COLOURS[barIndex];

        if (
          barColour !== undefined &&
          isInsideRoundedRect(x, y, left, top, width, barHeight, barRadius)
        ) {
          colour = barColour;
          break;
        }
      }

      const offset = (y * size + x) * CHANNELS;
      pixels[offset] = colour.red;
      pixels[offset + 1] = colour.green;
      pixels[offset + 2] = colour.blue;
      pixels[offset + 3] = 0xff;
    }
  }

  return encodePng(size, size, pixels);
};

const ICON_FILE_NAMES: Record<number, string> = {
  180: 'apple-touch-icon.png',
  192: 'icon-192.png',
  512: 'icon-512.png',
};

const main = (): void => {
  const iconsDirectory = join(PATHS.root, 'site', 'icons');
  ensureDirectory(iconsDirectory);

  for (const size of ICON_SIZES) {
    const fileName = ICON_FILE_NAMES[size] ?? `icon-${size}.png`;
    const filePath = join(iconsDirectory, fileName);
    const png = drawIcon(size);
    writeFileSync(filePath, png);
    logger.info(`wrote ${fileName}, ${size}x${size}, ${png.length} bytes`);
  }
};

main();

export { drawIcon, encodePng };
