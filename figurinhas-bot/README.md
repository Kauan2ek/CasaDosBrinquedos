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
