// Ponto de entrada da loja de figurinhas.
// Primeira execução: crie o administrador com as variáveis ADMIN_EMAIL e ADMIN_SENHA.
const { db } = require('./loja/db');
const { hashSenha } = require('./loja/auth');
const { criarApp } = require('./loja/app');

const PORTA = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '127.0.0.1';

function garantirAdmin() {
  const { ADMIN_EMAIL, ADMIN_SENHA } = process.env;
  const existe = db.prepare("SELECT id FROM usuarios WHERE papel = 'admin' LIMIT 1").get();
  if (existe) return;
  if (!ADMIN_EMAIL || !ADMIN_SENHA || ADMIN_SENHA.length < 8) {
    throw new Error('Nenhum administrador. Defina ADMIN_EMAIL e ADMIN_SENHA (mín. 8 caracteres) e inicie de novo.');
  }
  db.prepare("INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES ('Administrador', ?, ?, 'admin')")
    .run(ADMIN_EMAIL.trim().toLowerCase(), hashSenha(ADMIN_SENHA));
  console.log(`Administrador criado: ${ADMIN_EMAIL}`);
}

garantirAdmin();
criarApp().listen(PORTA, HOST, () => console.log(`Loja em http://${HOST}:${PORTA}`));
