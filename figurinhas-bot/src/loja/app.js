// Rotas da loja: login, administração (criar figurinhas e clientes, definir dono)
// e área do cliente (só as figurinhas dele).
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const express = require('express');
const { enviarPedidoPorEmail } = require('./email');
const multer = require('multer');
const { db, PASTA_ARQUIVOS } = require('./db');
const auth = require('./auth');
const { criarFigurinha, converterAudio, ehAnimada } = require('../conversor');
const { comMetadados } = require('../metadados');

const EXTENSOES = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm',
  'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/x-wav': '.wav',
  'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/aac': '.aac', 'audio/webm': '.webm',
};

// Preço e chave Pix (configuráveis por variável de ambiente)
const PRECO_CENTAVOS = Number(process.env.PRECO_FIGURINHA_CENTAVOS) || 100;
const PIX_CHAVE = process.env.PIX_CHAVE || 'nandaacruche@gmail.com';
// Nome que aparece quando a pessoa salva a figurinha ("publicado por" no WhatsApp)
const NOME_LOJA = process.env.LOJA_NOME || 'Loja de Figurinhas';
const reais = (centavos) => `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

// Tentativas de login por e-mail: trava por 15 min depois de 8 erros seguidos
const tentativasLogin = new Map();
const LIMITE_TENTATIVAS = 8;
const JANELA_MS = 15 * 60 * 1000;

function segundos(valor) {
  const n = Number(String(valor ?? '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

const agora = () => new Date().toISOString();

// Registra quem recebeu a figurinha (dono atual -> novo dono), com autor e data
function registrarHistorico({ figurinhaId, de, para, feitoPor }) {
  db.prepare(`INSERT INTO historico_dono (figurinha_id, de_usuario_id, para_usuario_id, feito_por_id)
              VALUES (?, ?, ?, ?)`).run(figurinhaId, de ?? null, para ?? null, feitoPor);
}

function clienteExiste(id) {
  return db.prepare("SELECT id FROM usuarios WHERE id = ? AND papel = 'cliente'").get(id);
}

function criarApp() {
  const app = express();
  app.use(express.json());
  app.use(auth.carregarUsuario);

  // ---------- Sessão ----------
  app.post('/api/login', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const senha = String(req.body.senha || '');
    const agoraMs = Date.now();
    const registro = tentativasLogin.get(email);
    if (registro && registro.bloqueadoAte > agoraMs) {
      return res.status(429).json({ erro: 'Muitas tentativas. Espere alguns minutos.' });
    }

    const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
    if (!usuario || !auth.senhaConfere(senha, usuario.senha_hash)) {
      const atual = registro && registro.bloqueadoAte < agoraMs ? { n: 0 } : (registro || { n: 0 });
      atual.n += 1;
      if (atual.n >= LIMITE_TENTATIVAS) atual.bloqueadoAte = agoraMs + JANELA_MS;
      tentativasLogin.set(email, atual);
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }

    tentativasLogin.delete(email);
    auth.definirCookie(res, auth.criarSessao(usuario.id));
    res.json({ ok: true, usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel } });
  });

  app.post('/api/logout', (req, res) => {
    const token = auth.lerCookie(req, 'sessao');
    if (token) auth.encerrarSessao(token);
    auth.limparCookie(res);
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => {
    if (!req.usuario) return res.status(401).json({ erro: 'Não logado.' });
    res.json({ usuario: req.usuario });
  });

  // ---------- Administração ----------
  app.get('/api/admin/usuarios', auth.exigirAdmin, (req, res) => {
    const lista = db.prepare(`
      SELECT id, nome, email, papel, criado_em FROM usuarios
      WHERE papel = 'cliente' ORDER BY nome`).all();
    res.json(lista);
  });

  // Só o admin cria contas de cliente: a loja não tem cadastro público
  app.post('/api/admin/usuarios', auth.exigirAdmin, (req, res) => {
    const nome = String(req.body.nome || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const senha = String(req.body.senha || '');
    if (!nome || !email.includes('@')) return res.status(400).json({ erro: 'Informe nome e e-mail válido.' });
    if (senha.length < 8) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 8 caracteres.' });
    try {
      const r = db.prepare("INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?, ?, ?, 'cliente')")
        .run(nome, email, auth.hashSenha(senha));
      res.status(201).json({ id: Number(r.lastInsertRowid), nome, email });
    } catch {
      res.status(400).json({ erro: 'Já existe um usuário com esse e-mail.' });
    }
  });

  app.get('/api/admin/figurinhas', auth.exigirAdmin, (req, res) => {
    const lista = db.prepare(`
      SELECT f.id, f.titulo, f.animada, f.arquivo_audio IS NOT NULL AS tem_audio, f.criado_em,
             f.dono_id, u.nome AS dono_nome, u.email AS dono_email
      FROM figurinhas f LEFT JOIN usuarios u ON u.id = f.dono_id
      ORDER BY f.id DESC`).all();
    res.json(lista);
  });

  app.post(
    '/api/admin/figurinhas',
    auth.exigirAdmin,
    upload.fields([{ name: 'midia', maxCount: 1 }, { name: 'audio', maxCount: 1 }]),
    async (req, res) => {
      try {
        const titulo = String(req.body.titulo || '').trim();
        const midia = req.files?.midia?.[0];
        const audio = req.files?.audio?.[0];
        if (!titulo) return res.status(400).json({ erro: 'Dê um título para a figurinha.' });
        if (!midia) return res.status(400).json({ erro: 'Envie uma imagem, GIF ou vídeo.' });

        const donoId = req.body.donoId ? Number(req.body.donoId) : null;
        if (donoId && !clienteExiste(donoId)) return res.status(400).json({ erro: 'Cliente não encontrado.' });

        const animada = ehAnimada(midia.mimetype, midia.originalname);
        const figurinha = await criarFigurinha({
          buffer: midia.buffer,
          extensao: EXTENSOES[midia.mimetype] || path.extname(midia.originalname).toLowerCase(),
          animada,
          inicio: segundos(req.body.inicioMidia),
          duracao: segundos(req.body.duracaoMidia) || undefined,
          texto: String(req.body.textoFigurinha || '').trim() || undefined,
        });
        const arquivoFigurinha = `${crypto.randomUUID()}.webp`;
        const comOrigem = comMetadados(figurinha, { nomePacote: titulo, autor: NOME_LOJA });
        await fs.writeFile(path.join(PASTA_ARQUIVOS, arquivoFigurinha), comOrigem);

        let arquivoAudio = null;
        if (audio) {
          const ogg = await converterAudio({
            buffer: audio.buffer,
            extensao: EXTENSOES[audio.mimetype] || path.extname(audio.originalname).toLowerCase(),
            inicio: segundos(req.body.inicioAudio),
            duracao: segundos(req.body.duracaoAudio) || undefined,
          });
          arquivoAudio = `${crypto.randomUUID()}.ogg`;
          await fs.writeFile(path.join(PASTA_ARQUIVOS, arquivoAudio), ogg);
        }

        const r = db.prepare(`INSERT INTO figurinhas (titulo, animada, arquivo_figurinha, arquivo_audio, dono_id)
                              VALUES (?, ?, ?, ?, ?)`)
          .run(titulo, animada ? 1 : 0, arquivoFigurinha, arquivoAudio, donoId);
        const id = Number(r.lastInsertRowid);
        registrarHistorico({ figurinhaId: id, de: null, para: donoId, feitoPor: req.usuario.id });
        res.status(201).json({ id, titulo });
      } catch (erro) {
        res.status(400).json({ erro: erro.message });
      }
    },
  );

  // Troca o dono (ou tira do dono, donoId = null). Fica registrado no histórico.
  app.put('/api/admin/figurinhas/:id/dono', auth.exigirAdmin, (req, res) => {
    const id = Number(req.params.id);
    const figurinha = db.prepare('SELECT id, dono_id FROM figurinhas WHERE id = ?').get(id);
    if (!figurinha) return res.status(404).json({ erro: 'Figurinha não encontrada.' });

    const novoDono = req.body.donoId ? Number(req.body.donoId) : null;
    if (novoDono && !clienteExiste(novoDono)) return res.status(400).json({ erro: 'Cliente não encontrado.' });

    db.prepare('UPDATE figurinhas SET dono_id = ? WHERE id = ?').run(novoDono, id);
    registrarHistorico({ figurinhaId: id, de: figurinha.dono_id, para: novoDono, feitoPor: req.usuario.id });
    res.json({ ok: true });
  });

  app.get('/api/admin/figurinhas/:id/historico', auth.exigirAdmin, (req, res) => {
    const lista = db.prepare(`
      SELECT h.quando,
             de.nome AS de_nome, para.nome AS para_nome, quem.nome AS feito_por_nome
      FROM historico_dono h
      LEFT JOIN usuarios de ON de.id = h.de_usuario_id
      LEFT JOIN usuarios para ON para.id = h.para_usuario_id
      LEFT JOIN usuarios quem ON quem.id = h.feito_por_id
      WHERE h.figurinha_id = ? ORDER BY h.id`).all(Number(req.params.id));
    res.json(lista);
  });

  // ---------- Cliente ----------
  app.get('/api/minhas-figurinhas', auth.exigirLogin, (req, res) => {
    const lista = db.prepare(`
      SELECT id, titulo, animada, arquivo_audio IS NOT NULL AS tem_audio, criado_em
      FROM figurinhas WHERE dono_id = ? ORDER BY id DESC`).all(req.usuario.id);
    res.json(lista);
  });

  // ---------- Pedidos ----------
  // O cliente envia as imagens/vídeos e o nome da figurinha. O pedido é gravado, vai por e-mail
  // com os arquivos anexados e o WhatsApp da loja abre com a mensagem pronta.
  const MAX_ARQUIVOS = 5;
  const MAX_TOTAL_BYTES = 15 * 1024 * 1024; // e-mail do Gmail aceita ~25 MB (com o anexo em base64)

  const arquivosDoPedido = (pedidoId) => db.prepare(`
    SELECT id, nome_original, mimetype, tamanho FROM pedido_arquivos WHERE pedido_id = ? ORDER BY id`).all(pedidoId);

  const comArquivos = (pedidos) => pedidos.map((p) => ({ ...p, arquivos: arquivosDoPedido(p.id) }));

  app.post('/api/pedidos', auth.exigirLogin, upload.array('arquivos', MAX_ARQUIVOS), async (req, res) => {
    try {
      const numeroLoja = (process.env.WHATSAPP_LOJA || '').replace(/\D/g, '');
      if (!numeroLoja) return res.status(500).json({ erro: 'Número de WhatsApp da loja não configurado.' });

      const nomeFigurinha = String(req.body.nomeFigurinha || '').trim();
      if (nomeFigurinha.length < 1) return res.status(400).json({ erro: 'Informe o nome que vai aparecer na figurinha.' });
      if (nomeFigurinha.length > 30) return res.status(400).json({ erro: 'O nome da figurinha pode ter até 30 caracteres.' });

      const descricao = String(req.body.descricao || '').trim();
      if (descricao.length > 1000) return res.status(400).json({ erro: 'Descrição muito longa (máx. 1000 caracteres).' });

      const arquivos = req.files || [];
      if (arquivos.length === 0) return res.status(400).json({ erro: 'Envie pelo menos uma imagem ou vídeo.' });
      for (const arq of arquivos) {
        if (!arq.mimetype.startsWith('image/') && !arq.mimetype.startsWith('video/')) {
          return res.status(400).json({ erro: `"${arq.originalname}" não é imagem nem vídeo.` });
        }
      }
      const totalBytes = arquivos.reduce((soma, arq) => soma + arq.size, 0);
      if (totalBytes > MAX_TOTAL_BYTES) {
        return res.status(400).json({ erro: 'Os arquivos somam mais de 15 MB. Envie menos ou menores.' });
      }

      const quantidade = Math.trunc(Number(req.body.quantidade));
      if (!Number.isFinite(quantidade) || quantidade < 1 || quantidade > 50) {
        return res.status(400).json({ erro: 'A quantidade precisa ser entre 1 e 50 figurinhas.' });
      }
      const valorCentavos = quantidade * PRECO_CENTAVOS;

      const r = db.prepare(`INSERT INTO pedidos (usuario_id, nome_figurinha, descricao, quantidade, valor_centavos)
                            VALUES (?, ?, ?, ?, ?)`)
        .run(req.usuario.id, nomeFigurinha, descricao, quantidade, valorCentavos);
      const id = Number(r.lastInsertRowid);

      const anexos = [];
      for (const arq of arquivos) {
        const ext = EXTENSOES[arq.mimetype] || path.extname(arq.originalname).toLowerCase() || '.bin';
        const nomeDisco = `${crypto.randomUUID()}${ext}`;
        await fs.writeFile(path.join(PASTA_ARQUIVOS, nomeDisco), arq.buffer);
        db.prepare(`INSERT INTO pedido_arquivos (pedido_id, arquivo, nome_original, mimetype, tamanho)
                    VALUES (?, ?, ?, ?, ?)`).run(id, nomeDisco, arq.originalname, arq.mimetype, arq.size);
        anexos.push({ nome: arq.originalname, buffer: arq.buffer });
      }

      const valor = reais(valorCentavos);
      const texto = [
        `Olá! Quero fazer um pedido de figurinha (pedido #${id}).`,
        `Cliente: ${req.usuario.nome}`,
        `Nome na figurinha: ${nomeFigurinha}`,
        `Quantidade: ${quantidade}`,
        `Total: ${valor}`,
        descricao ? `Descrição: ${descricao}` : null,
        `Enviei ${arquivos.length} arquivo(s) pelo site.`,
      ].filter(Boolean).join('\n');

      // Não bloqueia a resposta: se o e-mail falhar, o pedido e os arquivos já estão salvos
      enviarPedidoPorEmail({
        id, cliente: req.usuario, quantidade, valor, descricao, nomeFigurinha, anexos,
      }).catch((erro) => console.error('Falha ao enviar e-mail do pedido:', erro.message));

      res.status(201).json({
        id,
        quantidade,
        valor,
        pix: PIX_CHAVE,
        whatsappUrl: `https://wa.me/${numeroLoja}?text=${encodeURIComponent(texto)}`,
      });
    } catch (erro) {
      res.status(400).json({ erro: erro.message });
    }
  });

  app.get('/api/meus-pedidos', auth.exigirLogin, (req, res) => {
    const pedidos = db.prepare(`SELECT id, nome_figurinha, descricao, quantidade, valor_centavos, criado_em
                                FROM pedidos WHERE usuario_id = ? ORDER BY id DESC`).all(req.usuario.id);
    res.json(comArquivos(pedidos));
  });

  app.get('/api/admin/pedidos', auth.exigirAdmin, (req, res) => {
    const pedidos = db.prepare(`
      SELECT p.id, p.nome_figurinha, p.descricao, p.quantidade, p.valor_centavos, p.criado_em,
             u.nome AS cliente_nome, u.email AS cliente_email
      FROM pedidos p JOIN usuarios u ON u.id = p.usuario_id ORDER BY p.id DESC`).all();
    res.json(comArquivos(pedidos));
  });

  // Arquivo enviado no pedido: só o cliente dono do pedido ou o admin
  app.get('/api/pedidos/arquivos/:arquivoId', auth.exigirLogin, (req, res) => {
    const arq = db.prepare(`
      SELECT a.*, p.usuario_id FROM pedido_arquivos a JOIN pedidos p ON p.id = a.pedido_id WHERE a.id = ?`)
      .get(Number(req.params.arquivoId));
    if (!arq) return res.status(404).json({ erro: 'Arquivo não encontrado.' });
    if (req.usuario.papel !== 'admin' && arq.usuario_id !== req.usuario.id) {
      return res.status(404).json({ erro: 'Arquivo não encontrado.' });
    }
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(arq.nome_original)}"`);
    res.type(arq.mimetype);
    res.sendFile(path.join(PASTA_ARQUIVOS, arq.arquivo));
  });

  // ---------- Arquivos (só dono ou admin) ----------
  app.get('/api/figurinhas/:id/arquivo/:tipo', auth.exigirLogin, async (req, res) => {
    const f = db.prepare('SELECT * FROM figurinhas WHERE id = ?').get(Number(req.params.id));
    if (!f) return res.status(404).json({ erro: 'Figurinha não encontrada.' });
    const podeVer = req.usuario.papel === 'admin' || f.dono_id === req.usuario.id;
    if (!podeVer) return res.status(404).json({ erro: 'Figurinha não encontrada.' }); // não revela que existe

    const nomeArquivo = req.params.tipo === 'audio' ? f.arquivo_audio : f.arquivo_figurinha;
    if (!nomeArquivo) return res.status(404).json({ erro: 'Esta figurinha não tem áudio.' });
    const tipo = req.params.tipo === 'audio' ? 'audio/ogg' : 'image/webp';
    const ext = req.params.tipo === 'audio' ? 'ogg' : 'webp';
    res.type(tipo);
    res.setHeader('Content-Disposition', `attachment; filename="${f.id}-${req.params.tipo}.${ext}"`);
    res.sendFile(path.join(PASTA_ARQUIVOS, nomeArquivo));
  });

  app.use((erro, req, res, next) => {
    if (erro instanceof multer.MulterError) return res.status(400).json({ erro: 'Arquivo muito grande (máx. 30 MB).' });
    console.error(erro);
    res.status(500).json({ erro: 'Erro interno.' });
  });

  // Painel HTML: só o JS da página, os dados vêm das rotas acima
  app.use(express.static(path.join(__dirname, '..', '..', 'public', 'loja')));
  return app;
}

module.exports = { criarApp };
