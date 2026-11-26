// Banco de dados (SQLite embutido do Node 22.5+). Um arquivo só: dados/loja.db
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const PASTA_DADOS = path.join(__dirname, '..', '..', 'dados');
fs.mkdirSync(path.join(PASTA_DADOS, 'arquivos'), { recursive: true });

const db = new DatabaseSync(path.join(PASTA_DADOS, 'loja.db'));
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    papel TEXT NOT NULL CHECK (papel IN ('admin', 'cliente')),
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessoes (
    token_hash TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expira_em TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS figurinhas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    animada INTEGER NOT NULL DEFAULT 0,
    arquivo_figurinha TEXT NOT NULL,
    arquivo_audio TEXT,
    dono_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Pedidos feitos pelo cliente (depois o contato segue pelo WhatsApp)
  CREATE TABLE IF NOT EXISTS pedidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    descricao TEXT NOT NULL,
    quantidade INTEGER NOT NULL DEFAULT 1,
    valor_centavos INTEGER NOT NULL DEFAULT 0,
    arquivo_referencia TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Quem foi dono de cada figurinha e quando: rastreabilidade de vendas
  CREATE TABLE IF NOT EXISTS historico_dono (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    figurinha_id INTEGER NOT NULL REFERENCES figurinhas(id) ON DELETE CASCADE,
    de_usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    para_usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    feito_por_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    quando TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

module.exports = { db, PASTA_ARQUIVOS: path.join(PASTA_DADOS, 'arquivos') };
