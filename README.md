# PPTX → SCORM Converter

Conversor 100% web (sem servidor) de **PowerPoint (.pptx)** para
**SCORM 2004 4th Edition**, feito sob medida para a plataforma
[TONOFF Brasil EAD](https://databasecenter.github.io/tonoff/).

> Independência total: nada de iSpring, Articulate ou licença paga.

---

## Estado atual

| Passo | Descrição                                          | Status |
|-------|----------------------------------------------------|--------|
| 1     | Estrutura inicial + interface de upload            | ✅ pronto |
| 2     | Parser OOXML (extrai slides, texto, imagens)       | ⏳ próximo |
| 3     | Gerador SCORM (manifest + player + zip)            | ⏳ depois |
| 4     | Detecção de vídeos do YouTube                      | 🔜 |
| 5     | Player navegável + comunicação `API_1484_11`       | 🔜 |

O **passo 1** entrega:
- Drag & drop e seleção via diálogo
- Validação real do PPTX (é ZIP? tem `ppt/presentation.xml`?)
- Estatísticas instantâneas (slides, imagens, mídias)
- Log visual de cada etapa
- Arquitetura modular pronta pros próximos passos

---

## Como rodar localmente

Por ser 100% estático (HTML + JS), basta servir a pasta:

```bash
# opção 1: Python
python3 -m http.server 8000

# opção 2: Node (com http-server)
npx http-server .

# opção 3: VS Code "Live Server"
```

Depois abra `http://localhost:8000`.

> Não dá pra abrir o `index.html` direto via `file://` porque os
> scripts externos (JSZip via CDN) podem ser bloqueados pelo CORS
> em alguns navegadores. Use sempre um servidor local.

---

## Deploy no GitHub Pages

```bash
git init
git remote add origin git@github.com:<user>/pptx-to-scorm.git
git add .
git commit -m "passo 1: upload + validação"
git push -u origin main
```

Vá em **Settings → Pages**, selecione `main` branch e a pasta `/`.

---

## Estrutura do projeto

```
pptx-to-scorm/
├── index.html            ← interface (upload, dashboard)
├── converter.js          ← orquestrador (drop, validação, logs)
├── pptx-parser.js        ← parser OOXML  ← passo 2
├── scorm-generator.js    ← empacotador SCORM  ← passo 3
├── templates/            ← player.html / .js / .css (passo 3)
├── lib/                  ← libs locais (atualmente vazio; usamos CDN)
└── README.md
```

---

## Decisões técnicas

- **JSZip via CDN** em vez de bundlado: simplicidade no MVP. Se precisar
  funcionar offline, copiar `jszip.min.js` para `lib/` e trocar o `<script>`.
- **Sem framework**: HTML/CSS/JS vanilla. Compatível com GitHub Pages
  sem build step.
- **Quick scan no upload**: a contagem de slides feita no passo 1 é
  apenas regex sobre os nomes de arquivo dentro do ZIP — bem rápido.
  O parsing OOXML real (texto, posicionamento, mídias) entra no passo 2.

---

## Lições aprendidas que orientam a implementação

Erros do iSpring que **vamos evitar** no SCORM gerado:

- ❌ `youtube.com/embed/<id>?enablejsapi=1&origin=...` em iframe `blob:`
  causa "Erro 153"
  → ✅ vamos usar `youtube.com/embed/<id>` simples
- ❌ Recursos via HTTP em página HTTPS
  → ✅ todas as URLs serão HTTPS
- ❌ Estrutura profunda de pastas atrasa carregamento
  → ✅ pacote enxuto, `index.html` na raiz
- ❌ Wrappers proprietários que controlam o player
  → ✅ HTML5 puro

---

## Licença

Uso interno TONOFF TREINAMENTOS LTDA · CNPJ 45.776.667/0001-19.
