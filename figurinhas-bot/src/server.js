// Servidor local: página para montar a figurinha e um endpoint que envia para o WhatsApp.
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const { criarFigurinha, converterAudio } = require('./conversor');
const { conectar, localizarDestino, enviarFigurinhaComAudio, status } = require('./whatsapp');

const PORTA = Number(process.env.PORT) || 3000;
// Por padrão só aceita conexões desta máquina. Não exponha na internet sem autenticação.
const HOST = process.env.HOST || '127.0.0.1';
const TAMANHO_MAX_MB = 30;

const EXTENSOES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/webm': '.webm',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANHO_MAX_MB * 1024 * 1024 },
});

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/status', (req, res) => res.json(status()));

// Converte um número (texto do formulário) em segundos; vazio vira 0
function segundos(valor, padrao = 0) {
  const n = Number(String(valor ?? '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : padrao;
}

function extensaoDe(arquivo) {
  return EXTENSOES[arquivo.mimetype] || path.extname(arquivo.originalname || '').toLowerCase() || '';
}

app.post(
  '/api/enviar',
  upload.fields([
    { name: 'midia', maxCount: 1 },
    { name: 'audio', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const midia = req.files?.midia?.[0];
      const audio = req.files?.audio?.[0];
      if (!midia) return res.status(400).json({ erro: 'Envie uma imagem, GIF ou vídeo para a figurinha.' });

      // Só checa o destino antes de gastar tempo convertendo
      const jid = await localizarDestino(req.body.numero);

      const animada = midia.mimetype === 'image/gif' || midia.mimetype.startsWith('video/');
      const figurinha = await criarFigurinha({
        buffer: midia.buffer,
        extensao: extensaoDe(midia),
        animada,
        inicio: segundos(req.body.inicioMidia),
        duracao: segundos(req.body.duracaoMidia) || undefined,
      });

      let audioOgg = null;
      if (audio) {
        audioOgg = await converterAudio({
          buffer: audio.buffer,
          extensao: extensaoDe(audio),
          inicio: segundos(req.body.inicioAudio),
          duracao: segundos(req.body.duracaoAudio) || undefined,
        });
      }

      await enviarFigurinhaComAudio({ jid, figurinha, audio: audioOgg });

      res.json({
        ok: true,
        mensagem: audioOgg
          ? 'Figurinha e áudio enviados.'
          : 'Figurinha enviada (sem áudio).',
        animada,
        tamanhoKb: Math.round(figurinha.length / 1024),
      });
    } catch (erro) {
      console.error('Erro ao enviar:', erro.message);
      res.status(400).json({ erro: erro.message });
    }
  },
);

app.use((erro, req, res, next) => {
  if (erro instanceof multer.MulterError) {
    return res.status(400).json({ erro: `Arquivo muito grande (limite de ${TAMANHO_MAX_MB} MB).` });
  }
  res.status(500).json({ erro: 'Erro interno.' });
});

app.listen(PORTA, HOST, () => {
  console.log(`Painel em http://${HOST}:${PORTA}`);
  conectar().catch((e) => console.error('Falha ao iniciar o WhatsApp:', e.message));
});
