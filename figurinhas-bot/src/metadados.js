// Metadados de figurinha (EXIF dentro do WebP) no formato que o WhatsApp lê.
// Quando a pessoa salva a figurinha, o WhatsApp mostra o nome do pacote e quem publicou.
const crypto = require('node:crypto');

const LARGURA_FIGURINHA = 512;
const ALTURA_FIGURINHA = 512;

function chunk(id, dados) {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32LE(dados.length, 0);
  const pad = dados.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0);
  return Buffer.concat([Buffer.from(id, 'latin1'), tamanho, dados, pad]);
}

// Lê os chunks RIFF depois do cabeçalho "RIFF....WEBP"
function lerChunks(webp) {
  const corpo = webp.subarray(12);
  const chunks = [];
  let i = 0;
  while (i + 8 <= corpo.length) {
    const id = corpo.toString('latin1', i, i + 4);
    const tamanho = corpo.readUInt32LE(i + 4);
    chunks.push({ id, dados: corpo.subarray(i + 8, i + 8 + tamanho) });
    i += 8 + tamanho + (tamanho % 2);
  }
  return chunks;
}

// Monta o bloco EXIF com o JSON que o WhatsApp usa (campo UserComment, tag 0x5741)
function montarExif(info) {
  const json = Buffer.from(JSON.stringify(info), 'utf8');
  const cabecalho = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00,
    0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  ]);
  const exif = Buffer.concat([cabecalho, json]);
  exif.writeUInt32LE(json.length, 14);
  return exif;
}

/**
 * Retorna o WebP com o EXIF do WhatsApp.
 * @param {Buffer} webp  figurinha já convertida (512x512)
 * @param {{nomePacote: string, autor: string}} dados
 */
function comMetadados(webp, { nomePacote, autor }) {
  const info = {
    'sticker-pack-id': crypto.randomUUID(),
    'sticker-pack-name': String(nomePacote).slice(0, 60),
    'sticker-pack-publisher': String(autor).slice(0, 60),
    emojis: [],
  };
  const exifChunk = chunk('EXIF', montarExif(info));

  const chunks = lerChunks(webp);
  const vp8x = chunks.find((c) => c.id === 'VP8X');
  let novos;
  if (vp8x) {
    // Já é WebP estendido (ex.: animado): liga o bit de EXIF (0x08) nos flags
    const dados = Buffer.from(vp8x.dados);
    dados[0] |= 0x08;
    novos = [chunk('VP8X', dados), ...chunks.filter((c) => c.id !== 'VP8X').map((c) => chunk(c.id, c.dados))];
  } else {
    // WebP simples: precisa criar o cabeçalho VP8X (com alfa e EXIF ligados)
    const dados = Buffer.alloc(10);
    dados[0] = 0x08 | 0x10;
    dados.writeUIntLE(LARGURA_FIGURINHA - 1, 4, 3);
    dados.writeUIntLE(ALTURA_FIGURINHA - 1, 7, 3);
    novos = [chunk('VP8X', dados), ...chunks.map((c) => chunk(c.id, c.dados))];
  }
  novos.push(exifChunk);

  const corpo = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...novos]);
  const cabecalhoRiff = Buffer.alloc(8);
  cabecalhoRiff.write('RIFF', 0, 'latin1');
  cabecalhoRiff.writeUInt32LE(corpo.length, 4);
  return Buffer.concat([cabecalhoRiff, corpo]);
}

module.exports = { comMetadados };
