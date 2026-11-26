// Envio do pedido por e-mail para o dono da loja.
// Configure via variáveis: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_PEDIDOS.
const nodemailer = require('nodemailer');

const configurado = () =>
  process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.EMAIL_PEDIDOS;

let transporte = null;
function obterTransporte() {
  if (!transporte) {
    transporte = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 465,
      secure: (Number(process.env.SMTP_PORT) || 465) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporte;
}

async function enviarPedidoPorEmail({ id, cliente, quantidade, valor, descricao, temReferencia }) {
  if (!configurado()) {
    console.warn(`Pedido #${id} salvo, mas e-mail não enviado (SMTP/EMAIL_PEDIDOS não configurados).`);
    return;
  }
  const texto = [
    `Novo pedido #${id}`,
    '',
    `Cliente: ${cliente.nome} <${cliente.email}>`,
    `Quantidade: ${quantidade}`,
    `Total: ${valor}`,
    `Descrição: ${descricao}`,
    temReferencia ? 'Imagem de referência: anexada no painel da loja.' : 'Sem imagem de referência.',
    '',
    'Quando o pagamento Pix cair, envie a figurinha ao cliente.',
  ].join('\n');

  await obterTransporte().sendMail({
    from: `"Loja de Figurinhas" <${process.env.SMTP_USER}>`,
    to: process.env.EMAIL_PEDIDOS,
    subject: `Pedido #${id} de figurinha: ${quantidade} x ${valor}`,
    text: texto,
  });
}

module.exports = { enviarPedidoPorEmail, configurado };
