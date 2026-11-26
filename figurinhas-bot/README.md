# Figurinhas com Som para WhatsApp

Um painel local onde você monta uma figurinha (imagem, GIF ou vídeo), escolhe um trecho de áudio
e envia tudo para um contato do WhatsApp.

## Como funciona

1. Você monta a figurinha: a mídia vira WebP 512×512 com fundo transparente, dentro dos limites do WhatsApp
   (estática até 100 KB; animada até 6 s e 500 KB).
2. O áudio é convertido para Opus/OGG mono, o formato que o WhatsApp toca como nota de voz.
3. O bot envia a figurinha e, logo em seguida, o áudio para o número informado.

> **Importante:** figurinhas do WhatsApp não tocam som. O "figurinha com som" é uma figurinha seguida
> de uma nota de voz no mesmo chat. A pessoa toca o áudio logo após receber a figurinha.

## Pré-requisitos

- Node.js 20 ou superior
- ffmpeg com os codecs `libwebp` e `libopus` (no Ubuntu/Debian: `sudo apt install ffmpeg`;
  no macOS: `brew install ffmpeg`; no Windows: baixe em https://ffmpeg.org e coloque no PATH)

## Instalação e uso

```bash
cd figurinhas-bot
npm install
npm start
```

1. Abra http://localhost:3000
2. No celular: WhatsApp → **Aparelhos conectados** → **Conectar um aparelho** → escaneie o QR Code
   que aparece na página (ou no terminal).
3. Escolha a imagem/vídeo, ajuste o trecho se quiser, escolha o áudio (opcional),
   digite o número com DDI e DDD (ex.: `5511999999999`) e clique em **Enviar no WhatsApp**.

A sessão fica salva na pasta `sessao/`, então você só precisa escanear o QR Code uma vez.

## Configurações (variáveis de ambiente)

| Variável | Padrão        | Para que serve                                          |
|----------|---------------|---------------------------------------------------------|
| `PORT`   | `3000`        | Porta do painel                                         |
| `HOST`   | `127.0.0.1`   | Endereço de escuta. Só mude se souber o que está fazendo |

O painel aceita só conexões desta máquina por padrão. Não exponha ele na internet: qualquer pessoa
que acessar poderia enviar mensagens pela sua conta.

## Estrutura

```
src/
  conversor.js   # ffmpeg: figurinha (WebP) e áudio (Opus/OGG)
  whatsapp.js    # conexão com o WhatsApp (Baileys), envio e verificação do número
  server.js      # servidor Express e rota POST /api/enviar
public/
  index.html     # painel
```

## Avisos

- **Biblioteca não oficial.** O Baileys usa o protocolo do WhatsApp Web, sem a API oficial. Isso
  pode deixar de funcionar em atualizações do WhatsApp.
- **Risco para a conta.** Automação em conta pessoal pode levar a bloqueio. Use para enviar figurinhas
  para contatos que conhecem você, não para mensagens em massa ou spam.
- A pasta `sessao/` dá acesso à sua conta. Não compartilhe nem envie para o git (já está no `.gitignore`).
- Se o WhatsApp desconectar no celular, apague a pasta `sessao/` e escaneie o QR Code de novo.

---

# Loja de figurinhas (painel de vendas)

Além do bot, há uma loja web para vender figurinhas. Cada figurinha tem **um dono** (o cliente que comprou),
e o site só mostra e libera download para esse dono.

## Como iniciar

Precisa de **Node 22.5+** (usa o SQLite embutido do Node).

```bash
ADMIN_EMAIL=seu@email.com ADMIN_SENHA=uma-senha-forte WHATSAPP_LOJA=5511999999999 npm run loja
```

`WHATSAPP_LOJA` é o seu número com DDI e DDD. Os pedidos abrem uma conversa com você nesse número.

Abra http://localhost:3001. Na primeira execução o administrador é criado com essas variáveis;
depois disso elas não são mais necessárias.

## O que o administrador faz

- **Cadastra clientes** (nome, e-mail e senha inicial). Não existe cadastro público.
- **Cria figurinhas** (imagem, GIF ou vídeo, com áudio opcional) e já escolhe o cliente dono, ou deixa em estoque.
- **Troca o dono** de qualquer figurinha pelo menu da tabela. Cada troca fica no **histórico**, com data e quem fez.

## O que o cliente vê

- As figurinhas em que ele é o dono, com botões para baixar a figurinha e o áudio.
- **Fazer um pedido:** descreve a figurinha (e pode anexar uma imagem de referência). O pedido fica registrado
  e o WhatsApp da loja abre com a mensagem pronta. O cliente só precisa apertar enviar.
- Os próprios pedidos, com link para a imagem de referência.

O admin vê todos os pedidos recebidos, com cliente e imagem de referência.

## Onde ficam os dados

- `dados/loja.db`: usuários, sessões, figurinhas e histórico (SQLite).
- `dados/arquivos/`: os arquivos convertidos. Ficam fora da pasta pública; só são entregues pela rota
  que confere o dono.

Os dois ficam no `.gitignore`. Faça backup da pasta `dados/`, porque é ali que está o registro de quem comprou o quê.

## Segurança e limites

- Senhas guardadas com scrypt. Sessões em cookie `HttpOnly`, válidas por 7 dias.
- Login bloqueia por 15 minutos depois de 8 tentativas erradas para o mesmo e-mail.
- Arquivo de figurinha de outro cliente responde 404, sem revelar que existe.
- Roda só em `127.0.0.1`. Para vender pela internet, falta colocar HTTPS e um servidor de verdade na frente.
- **Pagamento não está incluído.** O site controla quem é dono, mas quem cobra e libera a venda continua sendo você
  (por enquanto, a pessoa compra por fora e você cadastra o cliente e marca a figurinha como dela).
- **Direitos autorais:** só venda figurinhas com conteúdo que você tem direito de usar. Áudios de músicas e
  personagens de terceiros podem ser cobrados pelo titular.
