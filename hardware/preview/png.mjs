/* 极简 PNG 编码器（灰度 8 位），只为了把 200×200 的屏幕内容存成图看
 *
 * 不引任何依赖：Node 自带 zlib 就够了。PNG 的结构就是
 * 签名 + IHDR + IDAT + IEND，每块前面有长度、后面有 CRC32。
 */

import zlib from "node:zlib";

const CRC_TABLE = (function () {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/**
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} gray 每个像素 0（黑）–255（白），长度 = width*height
 * @param {number} scale 整数放大倍数（最近邻，像墨水屏那样放大就是"一个点变一片"）
 */
export function encodeGrayPng(width, height, gray, scale) {
  const factor = Math.max(1, Math.floor(scale || 1));
  const outW = width * factor;
  const outH = height * factor;

  const stride = outW + 1;
  const raw = Buffer.alloc(stride * outH);
  for (let y = 0; y < outH; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0;                       /* 每行开头的过滤器字节：0 = 不滤波 */
    const srcY = Math.floor(y / factor) * width;
    for (let x = 0; x < outW; x++) {
      raw[rowStart + 1 + x] = gray[srcY + Math.floor(x / factor)];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(outW, 0);
  ihdr.writeUInt32BE(outH, 4);
  ihdr[8] = 8;   /* 位深 */
  ihdr[9] = 0;   /* 颜色类型：灰度 */
  ihdr[10] = 0;  /* 压缩方法 */
  ihdr[11] = 0;  /* 过滤方法 */
  ihdr[12] = 0;  /* 不隔行 */

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}
