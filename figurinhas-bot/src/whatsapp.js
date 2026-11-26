// Conexão com o WhatsApp (Baileys). Conecta pela sua conta, lendo um QR Code.
const path = require('node:path');
const pino = require('pino');
const QRCode = require('qrcode');
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

const PASTA_SESSAO = path.join(__dirname, '..', 'sessao');
const logger = pino({ level: 'silent' });

const estado = {
  conectado: false,
  qrDataUrl: null, // QR para mostrar na página
  ultimoErro: null,
};

let sock = null;
let tentativas = 0;

async function conectar() {
  const { state, saveCreds } = await useMultiFileAuthState(PASTA_SESSAO);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ['Figurinhas Bot', 'Desktop', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (atualizacao) => {
    const { connection, lastDisconnect, qr } = atualizacao;

    if (qr) {
      estado.qrDataUrl = await QRCode.toDataURL(qr);
      console.log('QR Code gerado. Abra http://localhost:3000 e escaneie pelo WhatsApp.');
    }

    if (connection === 'open') {
      estado.conectado = true;
      tentativas = 0;
      estado.qrDataUrl = null;
      estado.ultimoErro = null;
      console.log('WhatsApp conectado.');
    }

    if (connection === 'close') {
      estado.conectado = false;
      const codigo = lastDisconnect?.error?.output?.statusCode;
      const sessaoEncerrada = codigo === DisconnectReason.loggedOut;
      estado.ultimoErro = sessaoEncerrada
        ? 'Sessão encerrada no celular. Apague a pasta "sessao" e conecte de novo.'
        : `Conexão caiu (código ${codigo}). Reconectando...`;
      console.log(estado.ultimoErro);

      if (!sessaoEncerrada) {
        // Espera cada vez mais (5s, 10s, 20s... até 60s) para não entrar em loop
        tentativas += 1;
        const espera = Math.min(5000 * 2 ** (tentativas - 1), 60000);
        setTimeout(() => conectar().catch((e) => (estado.ultimoErro = e.message)), espera);
      }
    }
  });
}

// Recebe um número como "5511999999999" (com DDI e DDD, sem símbolos) e devolve o JID.
// Confere antes se o número tem WhatsApp, para não enviar para o nada.
async function localizarDestino(numero) {
  if (!sock || !estado.conectado) throw new Error('WhatsApp ainda não está conectado.');

  const somenteDigitos = String(numero || '').replace(/\D/g, '');
  if (somenteDigitos.length < 10) throw new Error('Número inválido. Use DDI + DDD + número, ex.: 5511999999999.');

  const [resultado] = await sock.onWhatsApp(somenteDigitos);
  if (!resultado?.exists) throw new Error(`O número ${somenteDigitos} não tem WhatsApp.`);
  return resultado.jid;
}

// Envia a figurinha e, logo em seguida, o áudio como nota de voz.
// Figurinhas do WhatsApp não tocam som, então o áudio vai como mensagem separada.
async function enviarFigurinhaComAudio({ jid, figurinha, audio }) {
  await sock.sendMessage(jid, { sticker: figurinha });
  if (audio) {
    await sock.sendMessage(jid, {
      audio,
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true,
    });
  }
}

function status() {
  return { conectado: estado.conectado, qr: estado.qrDataUrl, erro: estado.ultimoErro };
}

module.exports = { conectar, localizarDestino, enviarFigurinhaComAudio, status };
