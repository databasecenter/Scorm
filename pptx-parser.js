/* ═══════════════════════════════════════════════════════════════════════
   PPTX-PARSER.JS · Parser OOXML para arquivos .pptx
   ─────────────────────────────────────────────────────────────────────
   Extrai de cada slide:
   - Título (placeholder type="title" ou "ctrTitle")
   - Parágrafos de texto não-título
   - Imagens (com caminho resolvido via _rels)
   - Vídeos do YouTube (4 estratégias: hyperlink, videoFile, oleObj, scan)
   - Speaker notes (de ppt/notesSlides/notesSlideN.xml)
   - Posicionamento básico (em EMU; conversão fica pro renderizador)

   ENTRADA: instância JSZip já carregada
   SAÍDA:   Promise<ParsedDeck>

   Saída de exemplo:
   {
     title: "Treinamento NR-10",
     slideCount: 12,
     totalWords: 1234,
     slides: [
       {
         index: 1,
         title: "Apresentação inicial",
         paragraphs: ["Bem-vindo ao curso...", "Hoje vamos abordar..."],
         images: [{ id, path, ext, blob, x, y, cx, cy }],
         youtubeVideos: [{ videoId, url, source: 'hyperlink' }],
         notes: "Lembrar de mencionar o EPI..." | null
       }
     ],
     mediaFiles: { 'ppt/media/image1.png': Blob, ... }
   }
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── Utilitários XML ───────────────────────────────────────────────
  function parseXML(str) {
    const doc = new DOMParser().parseFromString(str, 'application/xml');
    const err = doc.getElementsByTagName('parsererror')[0];
    if (err) throw new Error('XML inválido: ' + err.textContent.slice(0, 120));
    return doc;
  }

  // getElementsByTagNameNS('*', 'localName') ignora prefixo (a:t, p:sp etc.)
  function $$(node, localName) {
    return Array.from(node.getElementsByTagNameNS('*', localName));
  }
  function $1(node, localName) {
    return node.getElementsByTagNameNS('*', localName)[0] || null;
  }

  // Resolve um caminho relativo dentro do ZIP.
  // Ex: base='ppt/slides/slide1.xml', target='../media/image1.png'
  //  →  'ppt/media/image1.png'
  function resolvePath(basePath, relativeTarget) {
    if (!relativeTarget) return null;
    if (/^https?:\/\//i.test(relativeTarget)) return relativeTarget; // URL externa
    // Remove barra inicial se houver
    if (relativeTarget.startsWith('/')) return relativeTarget.slice(1);
    const parts = basePath.split('/').slice(0, -1);
    relativeTarget.split('/').forEach((p) => {
      if (p === '..') parts.pop();
      else if (p && p !== '.') parts.push(p);
    });
    return parts.join('/');
  }

  // ─── Detecção de YouTube ───────────────────────────────────────────
  // Reconhece: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/embed/ID,
  //            youtube-nocookie.com/embed/ID, com ou sem query params
  function extractYouTubeId(url) {
    if (!url || typeof url !== 'string') return null;
    const patterns = [
      /youtube(?:-nocookie)?\.com\/watch\?(?:[^#]*?&)?v=([A-Za-z0-9_-]{11})/i,
      /youtu\.be\/([A-Za-z0-9_-]{11})/i,
      /youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{11})/i,
      /youtube(?:-nocookie)?\.com\/v\/([A-Za-z0-9_-]{11})/i,
    ];
    for (const re of patterns) {
      const m = url.match(re);
      if (m) return m[1];
    }
    return null;
  }

  // ─── Parser de _rels ───────────────────────────────────────────────
  // Retorna Map { rId → { type, target, targetMode } }
  async function readRels(zip, slidePath) {
    // 'ppt/slides/slide1.xml' → 'ppt/slides/_rels/slide1.xml.rels'
    const parts = slidePath.split('/');
    const filename = parts.pop();
    const relsPath = parts.concat('_rels', filename + '.rels').join('/');
    const file = zip.file(relsPath);
    if (!file) return new Map();

    const xml = await file.async('string');
    const doc = parseXML(xml);
    const rels = new Map();
    $$(doc, 'Relationship').forEach((r) => {
      rels.set(r.getAttribute('Id'), {
        type: r.getAttribute('Type') || '',
        target: r.getAttribute('Target') || '',
        targetMode: r.getAttribute('TargetMode') || 'Internal',
      });
    });
    return rels;
  }

  // ─── Extração de texto de um <a:p> ─────────────────────────────────
  // Concatena todos os <a:t> dentro do parágrafo (inclui line breaks <a:br>)
  function readParagraph(pNode) {
    const out = [];
    // Itera filhos diretos do parágrafo na ordem em que aparecem
    Array.from(pNode.childNodes).forEach((child) => {
      if (child.nodeType !== 1) return;
      const local = child.localName;
      if (local === 'r') {
        const t = $1(child, 't');
        if (t) out.push(t.textContent || '');
      } else if (local === 'br') {
        out.push('\n');
      } else if (local === 'fld') {
        // Field (data, número de slide etc.) — pega o texto se houver
        const t = $1(child, 't');
        if (t) out.push(t.textContent || '');
      }
    });
    return out.join('').replace(/\u00A0/g, ' ').trim();
  }

  // ─── Extração de textos de um shape ────────────────────────────────
  // Retorna { isTitle, paragraphs:[string] }
  function readShape(spNode) {
    const txBody = $1(spNode, 'txBody');
    if (!txBody) return null;

    // Determina se é placeholder de título
    const ph = $1(spNode, 'ph');
    const phType = ph ? (ph.getAttribute('type') || '') : '';
    const isTitle = ['title', 'ctrTitle'].includes(phType);

    const paragraphs = $$(txBody, 'p')
      .map(readParagraph)
      .filter((s) => s.length > 0);

    if (paragraphs.length === 0) return null;
    return { isTitle, paragraphs };
  }

  // ─── Helpers de posicionamento ────────────────────────────────────
  // EMU = English Metric Units. 914400 EMU = 1 polegada. 9525 EMU = 1px @ 96dpi.
  const EMU_PER_PX = 9525;

  function readXfrm(node) {
    const xfrm = $1(node, 'xfrm');
    if (!xfrm) return null;
    const off = $1(xfrm, 'off');
    const ext = $1(xfrm, 'ext');
    if (!off || !ext) return null;
    return {
      x: +off.getAttribute('x') || 0,
      y: +off.getAttribute('y') || 0,
      cx: +ext.getAttribute('cx') || 0,
      cy: +ext.getAttribute('cy') || 0,
      rot: +($1(xfrm, 'rot') ? xfrm.getAttribute('rot') || 0 : 0) / 60000, // graus
    };
  }

  // Helper: pega rId em qualquer formato (r:id, r:embed, r:link)
  function getRid(node, attr) {
    return node.getAttribute('r:' + attr) ||
      node.getAttributeNS(
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        attr
      );
  }

  // Lê parágrafo com formatação básica (font-size, bold, color, alignment)
  function readParagraphRich(pNode) {
    const pPr = $1(pNode, 'pPr');
    const align = pPr ? (pPr.getAttribute('algn') || 'l') : 'l';
    const indent = pPr ? +pPr.getAttribute('lvl') || 0 : 0;

    // Marker (bullet) do parágrafo
    const buChar = pPr ? $1(pPr, 'buChar') : null;
    const isBullet = !!(buChar || (pPr && $1(pPr, 'buAutoNum')));

    // Properties default a partir de <a:lstStyle> seriam ideais, mas pra MVP
    // pegamos da rPr do primeiro run com sz definido
    let fontSize = null, bold = false, italic = false, color = null;

    const runs = [];
    Array.from(pNode.childNodes).forEach((child) => {
      if (child.nodeType !== 1) return;
      if (child.localName === 'r') {
        const t = $1(child, 't');
        if (!t) return;
        const text = t.textContent || '';
        const rPr = $1(child, 'rPr');
        if (rPr && fontSize == null) {
          const sz = rPr.getAttribute('sz');
          if (sz) fontSize = +sz / 100; // centipoints → points
          if (rPr.getAttribute('b') === '1') bold = true;
          if (rPr.getAttribute('i') === '1') italic = true;
          const colorEl = $1(rPr, 'srgbClr');
          if (colorEl && colorEl.getAttribute('val')) {
            color = '#' + colorEl.getAttribute('val').toUpperCase();
          }
        }
        runs.push({ text, bold: rPr && rPr.getAttribute('b') === '1' });
      } else if (child.localName === 'br') {
        runs.push({ text: '\n', isBreak: true });
      } else if (child.localName === 'fld') {
        const t = $1(child, 't');
        if (t) runs.push({ text: t.textContent || '' });
      }
    });

    const text = runs.map((r) => r.text).join('').replace(/\u00A0/g, ' ').trim();
    if (!text) return null;

    return { text, runs, fontSize, bold, italic, color, align, isBullet, indent };
  }

  // ─── Extração ordenada de ELEMENTOS posicionados ─────────────────
  // Percorre o spTree em ordem e retorna [{ type, x, y, cx, cy, ... }]
  // Tipos: 'text' | 'image' | 'youtube' | 'shape'
  function extractElements(slideDoc, rels, slidePath) {
    const elements = [];
    const spTree = $1(slideDoc, 'spTree');
    if (!spTree) return elements;

    function visit(parent) {
      Array.from(parent.childNodes).forEach((node) => {
        if (node.nodeType !== 1) return;
        const local = node.localName;

        if (local === 'sp') {
          processShape(node, elements);
        } else if (local === 'pic') {
          processPicture(node, rels, slidePath, elements);
        } else if (local === 'grpSp') {
          // Group shape: posições são relativas ao grupo, mas pra MVP
          // pegamos as crianças com seus x/y absolutos do XML diretamente
          // (PowerPoint normalmente já põe coordenadas absolutas dentro do grupo)
          visit(node);
        }
      });
    }

    visit(spTree);
    return elements;
  }

  function processShape(spNode, elements) {
    const xfrm = readXfrm(spNode);
    if (!xfrm) return;

    const txBody = $1(spNode, 'txBody');
    const ph = $1(spNode, 'ph');
    const phType = ph ? (ph.getAttribute('type') || '') : '';
    const isTitle = ['title', 'ctrTitle'].includes(phType);

    if (!txBody) {
      // Shape decorativo (retângulo, linha, etc) — captura cor de preenchimento se sólida
      const solidFill = $1(spNode, 'solidFill');
      const srgbClr = solidFill ? $1(solidFill, 'srgbClr') : null;
      const fill = srgbClr ? '#' + (srgbClr.getAttribute('val') || '').toUpperCase() : null;
      if (fill) {
        elements.push({
          type: 'shape',
          ...xfrm,
          fill,
        });
      }
      return;
    }

    const paragraphs = $$(txBody, 'p')
      .map(readParagraphRich)
      .filter((p) => p);

    if (paragraphs.length === 0) return;

    // Anchor vertical do bodyPr ('t' top, 'ctr' center, 'b' bottom)
    const bodyPr = $1(txBody, 'bodyPr');
    const anchor = bodyPr ? (bodyPr.getAttribute('anchor') || 't') : 't';

    elements.push({
      type: 'text',
      ...xfrm,
      isTitle,
      anchor,
      paragraphs,
    });
  }

  function processPicture(picNode, rels, slidePath, elements) {
    const xfrm = readXfrm(picNode);
    if (!xfrm) return;

    // ⭐ Estratégia A: Online Video (PowerPoint Insert > Online Video)
    // Estrutura: p:pic > p:nvPicPr > p:nvPr > p:videoFile r:link="..."
    const videoFile = $1(picNode, 'videoFile');
    if (videoFile) {
      const rId = getRid(videoFile, 'link') || getRid(videoFile, 'id');
      if (rId) {
        const rel = rels.get(rId);
        if (rel && rel.target) {
          const videoId = extractYouTubeId(rel.target);
          if (videoId) {
            const blip = $1(picNode, 'blip');
            let thumbnailPath = null;
            if (blip) {
              const blipRId = getRid(blip, 'embed');
              if (blipRId) {
                const blipRel = rels.get(blipRId);
                if (blipRel) thumbnailPath = resolvePath(slidePath, blipRel.target);
              }
            }
            elements.push({
              type: 'youtube',
              ...xfrm,
              videoId,
              url: rel.target,
              thumbnailPath,
              source: 'videoFile',
            });
            return;
          }
        }
      }
    }

    // ⭐ Estratégia B: Imagem com HYPERLINK apontando pra YouTube
    // (Comum quando o usuário insere thumbnail manualmente e linka)
    const hlinks = $$(picNode, 'hlinkClick');
    for (const link of hlinks) {
      const rId = getRid(link, 'id');
      if (!rId) continue;
      const rel = rels.get(rId);
      if (!rel || rel.targetMode !== 'External') continue;
      const videoId = extractYouTubeId(rel.target);
      if (!videoId) continue;

      // É uma imagem-thumbnail apontando pra YouTube → trata como YT posicionado
      const blip = $1(picNode, 'blip');
      let thumbnailPath = null;
      if (blip) {
        const blipRId = getRid(blip, 'embed');
        if (blipRId) {
          const blipRel = rels.get(blipRId);
          if (blipRel) thumbnailPath = resolvePath(slidePath, blipRel.target);
        }
      }
      elements.push({
        type: 'youtube',
        ...xfrm,
        videoId,
        url: rel.target,
        thumbnailPath,
        source: 'hyperlink-image',
      });
      return;
    }

    // Imagem normal
    const blip = $1(picNode, 'blip');
    if (!blip) return;
    const rId = getRid(blip, 'embed');
    if (!rId) return;
    const rel = rels.get(rId);
    if (!rel) return;
    const path = resolvePath(slidePath, rel.target);
    if (!path) return;

    elements.push({
      type: 'image',
      ...xfrm,
      path,
    });
  }

  // ─── Extração de imagens (<p:pic>) ────────────────────────────────
  // Retorna [{ id, target, x, y, cx, cy }]
  function readImages(slideDoc, rels, slidePath) {
    const out = [];
    $$(slideDoc, 'pic').forEach((pic) => {
      const blip = $1(pic, 'blip');
      if (!blip) return;
      // r:embed (preferido) ou r:link (imagem externa, raro)
      const rId = blip.getAttributeNS(
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        'embed'
      ) || blip.getAttribute('r:embed');
      if (!rId) return;
      const rel = rels.get(rId);
      if (!rel) return;
      const path = resolvePath(slidePath, rel.target);
      if (!path) return;

      // Posição/tamanho (opcional) — em EMU
      let x = null, y = null, cx = null, cy = null;
      const xfrm = $1(pic, 'xfrm');
      if (xfrm) {
        const off = $1(xfrm, 'off');
        const ext = $1(xfrm, 'ext');
        if (off) { x = +off.getAttribute('x') || 0; y = +off.getAttribute('y') || 0; }
        if (ext) { cx = +ext.getAttribute('cx') || 0; cy = +ext.getAttribute('cy') || 0; }
      }

      out.push({ id: rId, path, x, y, cx, cy });
    });
    return out;
  }

  // ─── Extração de vídeos do YouTube ────────────────────────────────
  // 4 estratégias combinadas. Retorna [{ videoId, url, source }]
  function readYouTube(slideDoc, rels) {
    const found = new Map();   // videoId → { url, source }
    const add = (url, source) => {
      const id = extractYouTubeId(url);
      if (id && !found.has(id)) found.set(id, { videoId: id, url, source });
    };

    // A) Hyperlinks (<a:hlinkClick r:id="rIdN"> em qualquer lugar)
    //    ou <a:hlinkHover>, <a:hyperlink>
    ['hlinkClick', 'hlinkHover', 'hyperlink'].forEach((tag) => {
      $$(slideDoc, tag).forEach((link) => {
        const rId = link.getAttribute('r:id') ||
          link.getAttributeNS(
            'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
            'id'
          );
        if (!rId) return;
        const rel = rels.get(rId);
        if (rel && rel.targetMode === 'External') {
          add(rel.target, 'hyperlink');
        }
      });
    });

    // B) <p:videoFile r:link="rIdN">
    $$(slideDoc, 'videoFile').forEach((vf) => {
      const rId = vf.getAttribute('r:link') ||
        vf.getAttributeNS(
          'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
          'link'
        );
      if (!rId) return;
      const rel = rels.get(rId);
      if (rel) add(rel.target, 'videoFile');
    });

    // C) <p:oleObj r:id="..."> e <p14:media>
    ['oleObj', 'media'].forEach((tag) => {
      $$(slideDoc, tag).forEach((node) => {
        const rId = node.getAttribute('r:id') || node.getAttribute('r:link');
        if (!rId) return;
        const rel = rels.get(rId);
        if (rel) add(rel.target, tag);
      });
    });

    // D) Fallback: scan textual em todos os atributos (alguns PPTs guardam
    //    a URL do YouTube como atributo de extensão)
    rels.forEach((rel) => {
      if (rel.targetMode === 'External' && rel.target) {
        add(rel.target, 'rels-scan');
      }
    });

    return Array.from(found.values());
  }

  // ─── Extração de notas (speaker notes) ────────────────────────────
  // Ignora placeholders auxiliares: sldNum (número do slide), ftr (footer),
  // hdr (header), dt (data) — caso contrário viriam textos como "1", "2"…
  async function readNotes(zip, slidePath, rels) {
    let notesTarget = null;
    rels.forEach((rel) => {
      if (rel.type.endsWith('/notesSlide')) notesTarget = rel.target;
    });
    if (!notesTarget) return null;

    const notesPath = resolvePath(slidePath, notesTarget);
    const file = zip.file(notesPath);
    if (!file) return null;

    try {
      const xml = await file.async('string');
      const doc = parseXML(xml);

      const IGNORED_PH = new Set(['sldNum', 'ftr', 'hdr', 'dt']);
      const collected = [];

      $$(doc, 'sp').forEach((sp) => {
        const ph = $1(sp, 'ph');
        const phType = ph ? (ph.getAttribute('type') || '') : '';
        if (IGNORED_PH.has(phType)) return;
        const txBody = $1(sp, 'txBody');
        if (!txBody) return;
        $$(txBody, 'p').forEach((p) => {
          const text = readParagraph(p);
          if (text) collected.push(text);
        });
      });

      // Filtra placeholders default ("Click to add notes" etc.)
      const filtered = collected.filter(
        (p) => !/^(haga clic|click to add|adicione|adicionar|clique para)/i.test(p)
      );
      const text = filtered.join('\n').trim();
      return text.length > 0 ? text : null;
    } catch (e) {
      return null;
    }
  }

  // ─── Parse de um slide individual ─────────────────────────────────
  async function parseSlide(zip, slidePath, index, log) {
    const file = zip.file(slidePath);
    if (!file) throw new Error(`Slide não encontrado: ${slidePath}`);

    const xml = await file.async('string');
    const doc = parseXML(xml);

    const rels = await readRels(zip, slidePath);

    // Background do slide (cor sólida via <p:bg><p:bgPr><a:solidFill>)
    let bgColor = null;
    const bg = $1(doc, 'bg');
    if (bg) {
      const solidFill = $1(bg, 'solidFill');
      if (solidFill) {
        const srgb = $1(solidFill, 'srgbClr');
        if (srgb && srgb.getAttribute('val')) {
          bgColor = '#' + srgb.getAttribute('val').toUpperCase();
        }
      }
    }

    // ⭐ NOVO: extração ordenada de elementos posicionados
    const elements = extractElements(doc, rels, slidePath);

    // Identificação de título: primeiro elemento de texto com isTitle=true
    let title = null;
    elements.forEach((el) => {
      if (el.type === 'text' && el.isTitle && !title) {
        title = el.paragraphs.map((p) => p.text).join(' · ');
      }
    });

    // Campos LEGACY (derivados de elements, mantidos pra UI da preview)
    const paragraphs = [];
    elements.forEach((el) => {
      if (el.type === 'text' && !el.isTitle) {
        el.paragraphs.forEach((p) => paragraphs.push(p.text));
      }
    });

    // Heurística: se não foi achado título via placeholder, e existe um
    // elemento de texto com fontSize claramente maior que os outros, esse
    // é o provável título. Senão, primeiro parágrafo curto.
    if (!title) {
      const textEls = elements.filter((e) => e.type === 'text');
      if (textEls.length > 0) {
        // Maior fonte
        let maxFont = 0;
        textEls.forEach((el) => {
          el.paragraphs.forEach((p) => {
            if (p.fontSize && p.fontSize > maxFont) maxFont = p.fontSize;
          });
        });
        if (maxFont >= 28) {
          // Tem texto grande — pega o primeiro parágrafo com essa fonte
          for (const el of textEls) {
            for (const p of el.paragraphs) {
              if (p.fontSize === maxFont && !title) {
                title = p.text;
                // remove do legacy paragraphs
                const idx = paragraphs.indexOf(p.text);
                if (idx >= 0) paragraphs.splice(idx, 1);
                break;
              }
            }
            if (title) break;
          }
        }
        if (!title && paragraphs.length > 0 && paragraphs[0].length <= 80) {
          title = paragraphs.shift();
        }
      }
    }

    const images = elements
      .filter((el) => el.type === 'image')
      .map((el) => ({ id: null, path: el.path, x: el.x, y: el.y, cx: el.cx, cy: el.cy }));

    const youtubeVideos = elements
      .filter((el) => el.type === 'youtube')
      .map((el) => ({ videoId: el.videoId, url: el.url, source: 'videoFile' }));

    // YouTube via hyperlinks (pode não estar nos elements posicionados — ainda capturamos)
    const ytFromLinks = readYouTubeFromLinks(doc, rels);
    ytFromLinks.forEach((yt) => {
      if (!youtubeVideos.find((v) => v.videoId === yt.videoId)) {
        youtubeVideos.push(yt);
      }
    });

    const notes = await readNotes(zip, slidePath, rels);

    return {
      index,
      title,
      bgColor,          // ← cor de fundo (pode ser null = usa default branco)
      elements,         // ← NOVO: array de elementos posicionados
      paragraphs,       // legacy — usado pela UI da preview
      images,           // legacy
      youtubeVideos,    // legacy
      notes,
    };
  }

  // ─── YouTube via hyperlinks (não-posicionado) ─────────────────────
  // Pega vídeos do YouTube referenciados como hyperlink em texto/shape.
  // Para esses, NÃO sabemos a posição — eles serão exibidos como bloco extra.
  function readYouTubeFromLinks(slideDoc, rels) {
    const found = new Map();
    const add = (url, source) => {
      const id = extractYouTubeId(url);
      if (id && !found.has(id)) found.set(id, { videoId: id, url, source });
    };

    ['hlinkClick', 'hlinkHover'].forEach((tag) => {
      $$(slideDoc, tag).forEach((link) => {
        const rId = getRid(link, 'id');
        if (!rId) return;
        const rel = rels.get(rId);
        if (rel && rel.targetMode === 'External') {
          add(rel.target, 'hyperlink');
        }
      });
    });

    return Array.from(found.values());
  }

  // ─── Lê título da apresentação (docProps/core.xml) ────────────────
  async function readDeckTitle(zip) {
    const file = zip.file('docProps/core.xml');
    if (!file) return null;
    try {
      const xml = await file.async('string');
      const doc = parseXML(xml);
      const titleNode = $1(doc, 'title');
      const t = titleNode ? titleNode.textContent.trim() : '';
      return t || null;
    } catch (e) {
      return null;
    }
  }

  // ─── Lê ordem dos slides + tamanho (presentation.xml + rels) ──────
  async function readPresentationInfo(zip) {
    const presFile = zip.file('ppt/presentation.xml');
    if (!presFile) throw new Error('ppt/presentation.xml ausente');
    const presRelsFile = zip.file('ppt/_rels/presentation.xml.rels');
    if (!presRelsFile) throw new Error('ppt/_rels/presentation.xml.rels ausente');

    const presDoc = parseXML(await presFile.async('string'));
    const relsDoc = parseXML(await presRelsFile.async('string'));

    const relMap = new Map();
    $$(relsDoc, 'Relationship').forEach((r) => {
      relMap.set(r.getAttribute('Id'), r.getAttribute('Target'));
    });

    const sldIds = $$(presDoc, 'sldId');
    const slidePaths = [];
    sldIds.forEach((sld) => {
      const rId = sld.getAttribute('r:id') ||
        sld.getAttributeNS(
          'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
          'id'
        );
      const target = relMap.get(rId);
      if (target) {
        slidePaths.push(resolvePath('ppt/presentation.xml', target));
      }
    });

    // Tamanho do slide em EMU. Defaults: 9144000 x 6858000 (16:9 widescreen)
    const sldSz = $1(presDoc, 'sldSz');
    const slideSize = sldSz
      ? { cx: +sldSz.getAttribute('cx') || 9144000, cy: +sldSz.getAttribute('cy') || 6858000 }
      : { cx: 9144000, cy: 6858000 };

    return { slidePaths, slideSize };
  }

  // ─── API pública ───────────────────────────────────────────────────
  window.PPTXParser = {
    /**
     * Parseia um arquivo PPTX já carregado em JSZip.
     * @param {JSZip} zip
     * @param {(level:string,msg:string)=>void} [logger]
     * @returns {Promise<ParsedDeck>}
     */
    async parse(zip, logger) {
      const log = logger || (() => {});
      log('info', 'Iniciando parsing OOXML…');

      // 1. Título da apresentação
      const title = await readDeckTitle(zip);
      if (title) log('info', `Título da apresentação: "${title}"`);

      // 2. Ordem e tamanho dos slides
      const presInfo = await readPresentationInfo(zip);
      const { slidePaths, slideSize } = presInfo;
      log('ok', `Ordem de ${slidePaths.length} slide(s) determinada.`);
      log('info', `Tamanho do slide: ${(slideSize.cx/914400).toFixed(2)}" × ${(slideSize.cy/914400).toFixed(2)}"`);

      // 3. Parse de cada slide
      const slides = [];
      const mediaPaths = new Set();
      for (let i = 0; i < slidePaths.length; i++) {
        try {
          const parsed = await parseSlide(zip, slidePaths[i], i + 1, log);
          slides.push(parsed);
          parsed.images.forEach((img) => mediaPaths.add(img.path));
          // Log resumido
          const bits = [];
          if (parsed.paragraphs.length) bits.push(`${parsed.paragraphs.length} parág.`);
          if (parsed.images.length) bits.push(`${parsed.images.length} img`);
          if (parsed.youtubeVideos.length) bits.push(`${parsed.youtubeVideos.length} ▶YT`);
          if (parsed.notes) bits.push('notas');
          log('info',
            `Slide ${i + 1}: ${parsed.title ? `"${parsed.title}"` : '(sem título)'}` +
            (bits.length ? ` · ${bits.join(', ')}` : '')
          );
        } catch (err) {
          log('warn', `Slide ${i + 1}: falha — ${err.message}`);
          slides.push({
            index: i + 1,
            title: null,
            paragraphs: [],
            images: [],
            youtubeVideos: [],
            notes: null,
            error: err.message,
          });
        }
      }

      // 4. Coleta blobs das mídias usadas
      log('info', 'Coletando arquivos de mídia…');
      const mediaFiles = {};
      for (const path of mediaPaths) {
        const file = zip.file(path);
        if (file) {
          mediaFiles[path] = await file.async('blob');
        }
      }
      log('ok', `${Object.keys(mediaFiles).length} arquivo(s) de mídia coletado(s).`);

      // 5. Estatísticas
      const totalWords = slides.reduce(
        (n, s) => n +
          (s.title || '').split(/\s+/).filter(Boolean).length +
          s.paragraphs.reduce((m, p) => m + p.split(/\s+/).filter(Boolean).length, 0),
        0
      );
      const totalYouTube = slides.reduce((n, s) => n + s.youtubeVideos.length, 0);
      const totalImages = slides.reduce((n, s) => n + s.images.length, 0);

      log('ok',
        `Análise concluída: ${slides.length} slides, ${totalImages} imagens, ` +
        `${totalYouTube} vídeo(s) YouTube, ${totalWords} palavras.`
      );

      return {
        title,
        slideSize,
        slideCount: slides.length,
        totalWords,
        totalYouTube,
        totalImages,
        slides,
        mediaFiles,
      };
    },

    // Exporta utilitários para teste e uso pelo gerador
    _utils: { extractYouTubeId, resolvePath, EMU_PER_PX: 9525 },
  };
})();
