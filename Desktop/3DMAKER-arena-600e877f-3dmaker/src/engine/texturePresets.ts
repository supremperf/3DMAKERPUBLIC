import { zlibSync, strToU8 } from "fflate";
let brushed: string | undefined;
/** Normal map PNG procédurale : stries directionnelles, utilisable aussi sans DOM dans les tests. */
export function brushedNormalTexture(): string {
  if (brushed) return brushed;
  const size = 256,
    pixels = new Uint8Array((size * 4 + 1) * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const index = y * (size * 4 + 1) + 1 + x * 4;
      const ny =
        0.27 * Math.sin(y * 2.39996) + 0.08 * Math.sin(y * 0.731 + x * 0.023);
      const nx = 0.012 * Math.sin(x * 0.73 + y * 1.61),
        nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      pixels[index] = Math.round((nx * 0.5 + 0.5) * 255);
      pixels[index + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      pixels[index + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      pixels[index + 3] = 255;
    }
  const header = new Uint8Array(13),
    view = new DataView(header.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  header[8] = 8;
  header[9] = 6;
  const chunks = [
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlibSync(pixels)),
    pngChunk("IEND", new Uint8Array()),
  ];
  const png = new Uint8Array(8 + chunks.reduce((n, c) => n + c.length, 0));
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  for (const chunk of chunks) {
    png.set(chunk, offset);
    offset += chunk.length;
  }
  let binary = "";
  for (const byte of png) binary += String.fromCharCode(byte);
  brushed = `data:image/png;base64,${btoa(binary)}`;
  return brushed;
}
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length),
    view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(strToU8(type), 4);
  chunk.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, 8 + data.length)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  view.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0);
  return chunk;
}
