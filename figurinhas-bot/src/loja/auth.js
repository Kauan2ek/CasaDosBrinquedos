// Senhas (scrypt, da biblioteca padrão), sessões em cookie e checagem de permissão.
const crypto = require('node:crypto');
const { db } = require('./db');

const DURACAO_SESSAO_DIAS = 7;
const NOME_COOKIE = 'sessao';

function hashSenha(senha) {
  const sal = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(senha, sal, 64).toString('hex');
  return `${sal}:${hash}`;
}

function senhaConfere(senha, armazenado) {
  const [sal, hash] = armazenado.split(':');
  const esperado = Buffer.from(hash, 'hex');
  const calculado = crypto.scryptSync(senha, sal, esperado.length);
  return crypto.timingSafeEqual(calculado, esperado);
}

const sha256 = (texto) => crypto.createHash('sha256').update(texto).digest('hex');

// Guarda só o hash do token no banco; o token fica apenas no cookie do navegador
function criarSessao(usuarioId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + DURACAO_SESSAO_DIAS * 86400e3).toISOString();
  db.prepare('INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES (?, ?, ?)')
    .run(sha256(token), usuarioId, expira);
  return token;
}

function encerrarSessao(token) {
  db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(sha256(token));
}

function lerCookie(req, nome) {
  const cabecalho = req.headers.cookie || '';
  for (const parte of cabecalho.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nome) return decodeURIComponent(v.join('='));
  }
  return null;
}

// Coloca req.usuario se o cookie for de uma sessão válida
function carregarUsuario(req, res, next) {
  const token = lerCookie(req, NOME_COOKIE);
  req.usuario = null;
  if (token) {
    req.usuario = db.prepare(`
      SELECT u.id, u.nome, u.email, u.papel FROM sessoes s
      JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = ? AND s.expira_em > ?
    `).get(sha256(token), new Date().toISOString()) || null;
  }
  next();
}

function exigirLogin(req, res, next) {
  if (!req.usuario) return res.status(401).json({ erro: 'Faça login para continuar.' });
  next();
}

function exigirAdmin(req, res, next) {
  if (!req.usuario) return res.status(401).json({ erro: 'Faça login para continuar.' });
  if (req.usuario.papel !== 'admin') return res.status(403).json({ erro: 'Acesso restrito ao administrador.' });
  next();
}

function definirCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `${NOME_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DURACAO_SESSAO_DIAS * 86400}`,
  );
}

function limparCookie(res) {
  res.setHeader('Set-Cookie', `${NOME_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

module.exports = {
  hashSenha, senhaConfere, criarSessao, encerrarSessao, carregarUsuario,
  exigirLogin, exigirAdmin, definirCookie, limparCookie, lerCookie,
};
