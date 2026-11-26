// Converte mídias usando o ffmpeg (chamado direto, sem shell, para evitar
// injeção de comandos com nomes de arquivo estranhos).
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

// Limites do WhatsApp para figurinhas
const LIMITE_FIGURINHA_ESTATICA = 100 * 1024; // 100 KB
const LIMITE_FIGURINHA_ANIMADA = 500 * 1024; // 500 KB
const DURACAO_MAX_FIGURINHA = 6; // segundos (animadas)
const TAMANHO_FIGURINHA = 512;

// Qualidades testadas em ordem até caber no limite do WhatsApp
const QUALIDADES = [80, 60, 45, 30, 15];

function executarFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const processo = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
    let erro = '';
    processo.stderr.on('data', (d) => (erro += d));
    processo.on('error', (err) => reject(new Error(`Não consegui executar o ffmpeg: ${err.message}`)));
    processo.on('close', (codigo) => {
      if (codigo === 0) resolve();
      else reject(new Error(`ffmpeg falhou (código ${codigo}): ${erro.trim().split('\n').pop()}`));
    });
  });
}

async function criarPastaTemporaria() {
  const pasta = path.join(os.tmpdir(), `figurinha-${crypto.randomUUID()}`);
  await fs.mkdir(pasta, { recursive: true });
  return pasta;
}

// Grava o buffer recebido em disco para o ffmpeg ler
async function salvarEntrada(pasta, buffer, extensao) {
  const caminho = path.join(pasta, `entrada${extensao}`);
  await fs.writeFile(caminho, buffer);
  return caminho;
}

// Figurinha: 512x512, fundo transparente, proporção mantida.
// - Imagem estática -> WebP estático (máx. 100 KB)
// - GIF/vídeo -> WebP animado (máx. 6 s e 500 KB)
async function criarFigurinha({ buffer, extensao, animada, inicio = 0, duracao }) {
  const pasta = await criarPastaTemporaria();
  try {
    const entrada = await salvarEntrada(pasta, buffer, extensao);
    const tamanho = TAMANHO_FIGURINHA;
    const filtros = [
      animada ? 'fps=15' : null,
      `scale=${tamanho}:${tamanho}:force_original_aspect_ratio=decrease:flags=lanczos`,
      `pad=${tamanho}:${tamanho}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
      'format=rgba',
    ]
      .filter(Boolean)
      .join(',');

    const limite = animada ? LIMITE_FIGURINHA_ANIMADA : LIMITE_FIGURINHA_ESTATICA;
    const saida = path.join(pasta, 'figurinha.webp');

    const argsTempo = [];
    if (inicio > 0) argsTempo.push('-ss', String(inicio));
    if (animada) {
      const dur = Math.min(duracao || DURACAO_MAX_FIGURINHA, DURACAO_MAX_FIGURINHA);
      argsTempo.push('-t', String(dur));
    }

    let ultimoBuffer = null;
    for (const qualidade of QUALIDADES) {
      const codecArgs = animada
        ? ['-c:v', 'libwebp_anim', '-loop', '0', '-fps_mode', 'passthrough']
        : ['-c:v', 'libwebp', '-frames:v', '1'];

      await executarFfmpeg([
        ...argsTempo,
        '-i', entrada,
        '-vf', filtros,
        '-an',
        ...codecArgs,
        '-lossless', '0',
        '-q:v', String(qualidade),
        '-preset', 'picture',
        saida,
      ]);

      ultimoBuffer = await fs.readFile(saida);
      if (ultimoBuffer.length <= limite) return ultimoBuffer;
    }

    throw new Error(
      `A figurinha ficou com ${Math.round(ultimoBuffer.length / 1024)} KB, acima do limite de ` +
        `${Math.round(limite / 1024)} KB do WhatsApp. Use uma mídia mais simples ou um trecho menor.`,
    );
  } finally {
    await fs.rm(pasta, { recursive: true, force: true });
  }
}

// Áudio: Opus em .ogg, mono, que é o formato que o WhatsApp reproduz como nota de voz.
async function converterAudio({ buffer, extensao, inicio = 0, duracao }) {
  const pasta = await criarPastaTemporaria();
  try {
    const entrada = await salvarEntrada(pasta, buffer, extensao);
    const saida = path.join(pasta, 'audio.ogg');

    const argsTempo = [];
    if (inicio > 0) argsTempo.push('-ss', String(inicio));
    if (duracao) argsTempo.push('-t', String(duracao));

    await executarFfmpeg([
      ...argsTempo,
      '-i', entrada,
      '-vn',
      '-c:a', 'libopus',
      '-b:a', '48k',
      '-ac', '1',
      '-ar', '48000',
      '-application', 'voip',
      saida,
    ]);

    return await fs.readFile(saida);
  } finally {
    await fs.rm(pasta, { recursive: true, force: true });
  }
}

// Confere a duração de um arquivo de áudio/vídeo (em segundos)
function duracaoDoArquivo(buffer, extensao) {
  return (async () => {
    const pasta = await criarPastaTemporaria();
    try {
      const entrada = await salvarEntrada(pasta, buffer, extensao);
      const texto = await new Promise((resolve, reject) => {
        const p = spawn('ffprobe', [
          '-v', 'error', '-show_entries', 'format=duration',
          '-of', 'default=noprint_wrappers=1:nokey=1', entrada,
        ]);
        let saida = '';
        p.stdout.on('data', (d) => (saida += d));
        p.on('error', reject);
        p.on('close', (c) => (c === 0 ? resolve(saida.trim()) : reject(new Error('ffprobe falhou'))));
      });
      return Number(texto) || 0;
    } finally {
      await fs.rm(pasta, { recursive: true, force: true });
    }
  })();
}

module.exports = { criarFigurinha, converterAudio, duracaoDoArquivo, DURACAO_MAX_FIGURINHA };
