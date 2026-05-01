/* ═══════════════════════════════════════════════════════════════════════
   SCORM-GENERATOR.JS · Empacotador SCORM 2004 4th Edition
   ─────────────────────────────────────────────────────────────────────
   Recebe a estrutura do PPTXParser e gera um .zip baixável com:
     imsmanifest.xml
     index.html        ← player principal (autocontido)
     player.css
     player.js         ← navegação + comunicação API_1484_11
     slides.json       ← dados estruturados
     media/            ← imagens copiadas com nomes únicos

   COMPATÍVEL COM:
     - Plataforma TONOFF (detecta launchURL via <resource href>)
     - SCORM Cloud, Moodle, Blackboard

   PADRÕES SEGUIDOS (lições aprendidas com iSpring):
     ✓ Vídeos YouTube via iframe SIMPLES /embed/{id}
       SEM enablejsapi, SEM origin, SEM wrappers proprietários
     ✓ Tudo HTTPS — zero Mixed Content
     ✓ Estrutura plana — index.html na raiz
     ✓ Reporta progresso real via cmi.progress_measure
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── Helpers ───────────────────────────────────────────────────────
  function uuid() {
    // RFC4122-ish, suficiente pra identifier
    return 'TONOFF-' + Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2, 10).toUpperCase();
  }

  function escapeXml(s) {
    return String(s == null ? '' : s).replace(/[<>&'"]/g, (c) => ({
      '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
    }[c]));
  }

  // Sanitiza nome de arquivo pra ASCII seguro (preserva extensão)
  function safeFilename(originalPath) {
    const name = originalPath.split('/').pop();
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    const safe = base
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove diacríticos
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 60);
    return (safe || 'file') + ext.toLowerCase();
  }

  // ─── Manifest XML ──────────────────────────────────────────────────
  function buildManifest(parsed, opts, mediaList) {
    const id = opts.identifier || uuid();
    const title = escapeXml(opts.title || parsed.title || 'Apresentação TONOFF');
    const lang = opts.language || 'pt-BR';

    const fileEntries = [
      'index.html',
      'player.css',
      'player.js',
      'slides.json',
      ...mediaList.map((m) => m.scormPath),
    ].map((p) => `      <file href="${escapeXml(p)}"/>`).join('\n');

    return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<manifest identifier="${escapeXml(id)}" version="1.0"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
  xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 imscp_v1p1.xsd
                      http://www.adlnet.org/xsd/adlcp_v1p3 adlcp_v1p3.xsd
                      http://www.adlnet.org/xsd/adlseq_v1p3 adlseq_v1p3.xsd
                      http://www.adlnet.org/xsd/adlnav_v1p3 adlnav_v1p3.xsd
                      http://www.imsglobal.org/xsd/imsss imsss_v1p0.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
  </metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>${title}</title>
      <item identifier="ITEM-1" identifierref="RES-1">
        <title>${title}</title>
        <adlcp:completionThreshold completedByMeasure="true" minProgressMeasure="0.95"/>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormType="sco" href="index.html">
${fileEntries}
    </resource>
  </resources>
</manifest>`;
  }

  // ─── slides.json ───────────────────────────────────────────────────
  function buildSlidesData(parsed, mediaMap) {
    return parsed.slides.map((s) => ({
      index: s.index,
      title: s.title || '',
      paragraphs: s.paragraphs || [],
      images: (s.images || []).map((img) => ({
        src: mediaMap[img.path] || null,   // caminho dentro do SCORM (ex: media/image1.png)
        x: img.x, y: img.y, cx: img.cx, cy: img.cy,
      })).filter((i) => i.src),
      youtubeVideos: (s.youtubeVideos || []).map((yt) => ({
        videoId: yt.videoId,
        url: 'https://www.youtube.com/embed/' + yt.videoId,
      })),
      notes: s.notes || '',
    }));
  }

  // ─── PLAYER HTML ───────────────────────────────────────────────────
  function buildPlayerHTML(parsed, opts) {
    const title = escapeXml(opts.title || parsed.title || 'Apresentação TONOFF');
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<link rel="stylesheet" href="player.css">
</head>
<body>
<div id="app" class="app">

  <header class="topbar">
    <div class="topbar-title" id="deckTitle">${title}</div>
    <div class="topbar-progress">
      <span id="slideCounter">— / —</span>
    </div>
  </header>

  <main class="stage" id="stage">
    <div class="loader">Carregando…</div>
  </main>

  <footer class="navbar">
    <button class="nav-btn nav-prev" id="btnPrev" disabled aria-label="Slide anterior">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="m15 18-6-6 6-6"/>
      </svg>
      <span>Anterior</span>
    </button>

    <div class="progress-track">
      <div class="progress-fill" id="progressFill"></div>
    </div>

    <button class="nav-btn nav-next" id="btnNext" aria-label="Próximo slide">
      <span>Próximo</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="m9 18 6-6-6-6"/>
      </svg>
    </button>
  </footer>

</div>
<script src="player.js"></script>
</body>
</html>`;
  }

  // ─── PLAYER CSS ────────────────────────────────────────────────────
  function buildPlayerCSS() {
    return `/* TONOFF SCORM Player */
*,*::before,*::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; }
body {
  background: #0A0E14;
  color: #E8EDF5;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  overflow: hidden;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100%;
}

/* ─── Topbar ─────────────────────────────────────────────────── */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: #11161F;
  border-bottom: 1px solid #2A3447;
  flex-shrink: 0;
}
.topbar-title {
  font-weight: 600;
  font-size: 15px;
  color: #FFB800;
  letter-spacing: 0.3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 70%;
}
.topbar-progress {
  font-size: 13px;
  color: #8A95AB;
  font-variant-numeric: tabular-nums;
  letter-spacing: 1px;
}

/* ─── Stage (área do slide) ─────────────────────────────────── */
.stage {
  flex: 1;
  overflow-y: auto;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 32px 24px;
  background: #0A0E14;
  scroll-behavior: smooth;
}
.stage::-webkit-scrollbar { width: 8px; }
.stage::-webkit-scrollbar-track { background: #11161F; }
.stage::-webkit-scrollbar-thumb { background: #3D4A63; border-radius: 4px; }

.slide {
  width: 100%;
  max-width: 960px;
  background: #FFFFFF;
  color: #1A1A1A;
  border-radius: 4px;
  padding: 48px 56px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  animation: slideIn 0.3s ease;
  min-height: 540px;
}
@keyframes slideIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.slide-title {
  font-size: 32px;
  font-weight: 700;
  color: #1A1A1A;
  margin: 0 0 24px 0;
  line-height: 1.2;
  border-bottom: 3px solid #FFB800;
  padding-bottom: 12px;
}
.slide-paragraph {
  font-size: 17px;
  line-height: 1.6;
  margin: 0 0 14px 0;
  color: #2A2A2A;
  white-space: pre-wrap;
}
.slide-paragraph:last-child { margin-bottom: 0; }

.slide-images {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin: 24px 0;
}
.slide-images.is-single { grid-template-columns: 1fr; }
.slide-image {
  width: 100%;
  border: 1px solid #E0E0E0;
  background: #F8F8F8;
}
.slide-image img {
  width: 100%;
  height: auto;
  display: block;
}

.slide-video {
  margin: 24px 0;
  position: relative;
  padding-bottom: 56.25%;  /* 16:9 */
  height: 0;
  overflow: hidden;
  background: #000;
  border-radius: 4px;
}
.slide-video iframe {
  position: absolute;
  top: 0; left: 0;
  width: 100%;
  height: 100%;
  border: 0;
}
.slide-video-caption {
  font-size: 13px;
  color: #666;
  margin-top: 8px;
  text-align: center;
}

.slide-notes {
  margin-top: 32px;
  padding: 16px 20px;
  background: #FFF8E1;
  border-left: 4px solid #FFB800;
  font-size: 14px;
  color: #5A4A1A;
  line-height: 1.5;
  border-radius: 2px;
  white-space: pre-wrap;
}
.slide-notes-label {
  display: block;
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: #B07E00;
  margin-bottom: 6px;
}

.slide-empty {
  color: #999;
  font-style: italic;
  text-align: center;
  padding: 80px 0;
}

.loader {
  text-align: center;
  color: #8A95AB;
  font-size: 14px;
  letter-spacing: 1px;
  text-transform: uppercase;
  padding: 80px 0;
}

/* ─── Navbar ─────────────────────────────────────────────────── */
.navbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 24px;
  background: #11161F;
  border-top: 1px solid #2A3447;
  flex-shrink: 0;
}

.nav-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  background: transparent;
  color: #E8EDF5;
  border: 1px solid #3D4A63;
  border-radius: 3px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.5px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.nav-btn:hover:not(:disabled) {
  border-color: #FFB800;
  color: #FFB800;
}
.nav-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.nav-next {
  background: #FFB800;
  color: #0A0E14;
  border-color: #FFB800;
}
.nav-next:hover:not(:disabled) {
  background: #FFC833;
  color: #0A0E14;
}
.nav-next.is-finished {
  background: #4ADE80;
  border-color: #4ADE80;
}

.progress-track {
  flex: 1;
  height: 4px;
  background: #1A2130;
  border-radius: 2px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #FFB800, #FFC833);
  width: 0%;
  transition: width 0.3s ease;
}

/* ─── Responsivo ─────────────────────────────────────────────── */
@media (max-width: 640px) {
  .topbar { padding: 10px 14px; }
  .topbar-title { font-size: 13px; max-width: 60%; }
  .stage { padding: 16px 12px; }
  .slide { padding: 24px 20px; min-height: auto; }
  .slide-title { font-size: 22px; margin-bottom: 16px; }
  .slide-paragraph { font-size: 15px; }
  .navbar { padding: 10px 12px; gap: 8px; }
  .nav-btn { padding: 8px 12px; font-size: 12px; }
  .nav-btn span { display: none; }   /* só ícone no mobile */
}`;
  }

  // ─── PLAYER JS ─────────────────────────────────────────────────────
  // Comunicação SCORM 2004 (API_1484_11) + navegação entre slides
  function buildPlayerJS() {
    return `/* TONOFF SCORM Player · Runtime */
(function () {
  'use strict';

  // ─── Localiza API SCORM 2004 (API_1484_11) ───────────────────────
  function findAPI() {
    let win = window;
    let depth = 0;
    while (win && depth < 12) {
      if (win.API_1484_11) return win.API_1484_11;
      if (win.parent && win.parent !== win) win = win.parent;
      else break;
      depth++;
    }
    if (window.opener && window.opener.API_1484_11) {
      return window.opener.API_1484_11;
    }
    return null;
  }

  const API = findAPI();
  let scormReady = false;
  if (API) {
    try {
      const ok = API.Initialize('');
      scormReady = (ok === 'true' || ok === true);
      console.log('[SCORM] API encontrada e inicializada:', scormReady);
    } catch (e) { console.warn('[SCORM] Initialize falhou:', e); }
  } else {
    console.log('[SCORM] API não encontrada — modo standalone.');
  }

  function scormSet(key, value) {
    if (!scormReady) return;
    try { API.SetValue(key, String(value)); } catch (e) {}
  }
  function scormGet(key) {
    if (!scormReady) return '';
    try { return API.GetValue(key); } catch (e) { return ''; }
  }
  function scormCommit() {
    if (!scormReady) return;
    try { API.Commit(''); } catch (e) {}
  }
  function scormTerminate() {
    if (!scormReady) return;
    try { API.Terminate(''); } catch (e) {}
    scormReady = false;
  }

  // ─── Estado ──────────────────────────────────────────────────────
  let slides = [];
  let current = 0;
  let visited = new Set();
  let startTime = Date.now();

  // ─── Refs ────────────────────────────────────────────────────────
  const stage = document.getElementById('stage');
  const counter = document.getElementById('slideCounter');
  const fill = document.getElementById('progressFill');
  const btnPrev = document.getElementById('btnPrev');
  const btnNext = document.getElementById('btnNext');

  // ─── Renderização do slide ──────────────────────────────────────
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderSlide(i) {
    const s = slides[i];
    if (!s) {
      stage.innerHTML = '<div class="slide"><p class="slide-empty">Slide não encontrado.</p></div>';
      return;
    }
    const parts = [];
    parts.push('<article class="slide">');

    if (s.title) {
      parts.push('<h1 class="slide-title">' + escapeHtml(s.title) + '</h1>');
    }

    // Imagens (antes dos parágrafos pra leitura natural)
    if (s.images && s.images.length > 0) {
      const cls = s.images.length === 1 ? 'is-single' : '';
      parts.push('<div class="slide-images ' + cls + '">');
      s.images.forEach(function (img) {
        parts.push('<div class="slide-image"><img src="' + escapeHtml(img.src) + '" alt=""></div>');
      });
      parts.push('</div>');
    }

    // Parágrafos
    if (s.paragraphs && s.paragraphs.length > 0) {
      s.paragraphs.forEach(function (p) {
        parts.push('<p class="slide-paragraph">' + escapeHtml(p) + '</p>');
      });
    }

    // Vídeos do YouTube — IFRAME SIMPLES, sem enablejsapi (evita Erro 153)
    if (s.youtubeVideos && s.youtubeVideos.length > 0) {
      s.youtubeVideos.forEach(function (yt) {
        parts.push(
          '<div class="slide-video">' +
            '<iframe src="' + escapeHtml(yt.url) + '" ' +
              'title="YouTube video ' + escapeHtml(yt.videoId) + '" ' +
              'allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture" ' +
              'allowfullscreen referrerpolicy="strict-origin-when-cross-origin">' +
            '</iframe>' +
          '</div>'
        );
      });
    }

    // Notas (visíveis pro aluno; útil em treinamento)
    if (s.notes) {
      parts.push(
        '<div class="slide-notes">' +
          '<span class="slide-notes-label">Notas do instrutor</span>' +
          escapeHtml(s.notes) +
        '</div>'
      );
    }

    if (!s.title && (!s.paragraphs || s.paragraphs.length === 0) &&
        (!s.images || s.images.length === 0) &&
        (!s.youtubeVideos || s.youtubeVideos.length === 0)) {
      parts.push('<p class="slide-empty">(slide sem conteúdo identificável)</p>');
    }

    parts.push('</article>');
    stage.innerHTML = parts.join('');
    stage.scrollTop = 0;
  }

  // ─── Navegação ──────────────────────────────────────────────────
  function goto(i) {
    if (i < 0 || i >= slides.length) return;
    current = i;
    visited.add(i);
    renderSlide(i);
    updateUI();
    saveProgress();
  }

  function updateUI() {
    counter.textContent = (current + 1) + ' / ' + slides.length;
    btnPrev.disabled = current === 0;
    const isLast = current === slides.length - 1;
    btnNext.disabled = isLast;

    // Progresso baseado em slides VISITADOS (não só posição atual)
    const progress = visited.size / slides.length;
    fill.style.width = (progress * 100).toFixed(1) + '%';

    if (isLast) {
      btnNext.classList.add('is-finished');
      btnNext.querySelector('span').textContent = 'Concluído';
    } else {
      btnNext.classList.remove('is-finished');
      btnNext.querySelector('span').textContent = 'Próximo';
    }
  }

  // ─── Comunicação SCORM ──────────────────────────────────────────
  function saveProgress() {
    scormSet('cmi.location', String(current));

    const progress = visited.size / slides.length;
    scormSet('cmi.progress_measure', progress.toFixed(4));

    // Marca completed quando todos visitados (>= 95% — alinhado com manifest)
    if (progress >= 0.95) {
      scormSet('cmi.completion_status', 'completed');
      scormSet('cmi.success_status', 'passed');
      scormSet('cmi.score.scaled', '1');
    } else {
      scormSet('cmi.completion_status', 'incomplete');
    }

    // session_time formato ISO 8601 duration (PT0H0M0S)
    const secs = Math.floor((Date.now() - startTime) / 1000);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const sc = secs % 60;
    scormSet('cmi.session_time', 'PT' + h + 'H' + m + 'M' + sc + 'S');

    scormCommit();
  }

  function restoreProgress() {
    const loc = scormGet('cmi.location');
    if (loc !== '' && loc != null) {
      const idx = parseInt(loc, 10);
      if (!isNaN(idx) && idx >= 0 && idx < slides.length) {
        return idx;
      }
    }
    return 0;
  }

  // ─── Event listeners ────────────────────────────────────────────
  btnPrev.addEventListener('click', function () { goto(current - 1); });
  btnNext.addEventListener('click', function () { goto(current + 1); });

  // Teclado: setas e PageUp/PageDown
  document.addEventListener('keydown', function (e) {
    if (['ArrowRight','PageDown',' '].includes(e.key)) {
      e.preventDefault();
      if (current < slides.length - 1) goto(current + 1);
    } else if (['ArrowLeft','PageUp'].includes(e.key)) {
      e.preventDefault();
      if (current > 0) goto(current - 1);
    }
  });

  // Ao fechar/sair, salva e termina
  window.addEventListener('pagehide', function () {
    saveProgress();
    scormTerminate();
  });
  window.addEventListener('beforeunload', function () {
    saveProgress();
    scormTerminate();
  });

  // Auto-commit periódico (segurança)
  setInterval(saveProgress, 30000);

  // ─── Bootstrap ───────────────────────────────────────────────────
  fetch('slides.json')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      slides = data;
      if (!slides.length) {
        stage.innerHTML = '<div class="slide"><p class="slide-empty">Apresentação vazia.</p></div>';
        return;
      }
      const startAt = restoreProgress();
      goto(startAt);
    })
    .catch(function (err) {
      console.error('Falha ao carregar slides.json:', err);
      stage.innerHTML = '<div class="slide"><p class="slide-empty">Erro ao carregar conteúdo.</p></div>';
    });
})();`;
  }

  // ─── Função principal de geração ───────────────────────────────────
  async function generate(parsed, opts, logger) {
    opts = opts || {};
    const log = logger || (() => {});

    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip não disponível.');
    }
    if (!parsed || !parsed.slides) {
      throw new Error('Estrutura ParsedDeck inválida.');
    }

    const zip = new JSZip();

    // 1. Copia mídia para media/, com nomes únicos seguros.
    log('info', 'Copiando arquivos de mídia para o pacote…');
    const mediaList = [];   // [{ originalPath, scormPath }]
    const mediaMap = {};    // originalPath → scormPath
    const usedNames = new Set();

    for (const [origPath, blob] of Object.entries(parsed.mediaFiles || {})) {
      let safe = safeFilename(origPath);
      // Garante unicidade
      if (usedNames.has(safe)) {
        const dot = safe.lastIndexOf('.');
        const base = dot > 0 ? safe.slice(0, dot) : safe;
        const ext = dot > 0 ? safe.slice(dot) : '';
        let n = 1;
        while (usedNames.has(`${base}_${n}${ext}`)) n++;
        safe = `${base}_${n}${ext}`;
      }
      usedNames.add(safe);
      const scormPath = `media/${safe}`;
      zip.file(scormPath, blob);
      mediaList.push({ originalPath: origPath, scormPath });
      mediaMap[origPath] = scormPath;
    }
    log('ok', `${mediaList.length} arquivo(s) de mídia copiado(s).`);

    // 2. slides.json
    log('info', 'Gerando slides.json…');
    const slidesData = buildSlidesData(parsed, mediaMap);
    zip.file('slides.json', JSON.stringify(slidesData, null, 2));

    // 3. Player (HTML / CSS / JS)
    log('info', 'Gerando player SCORM…');
    zip.file('index.html', buildPlayerHTML(parsed, opts));
    zip.file('player.css', buildPlayerCSS());
    zip.file('player.js', buildPlayerJS());

    // 4. Manifest
    log('info', 'Gerando imsmanifest.xml…');
    zip.file('imsmanifest.xml', buildManifest(parsed, opts, mediaList));

    // 5. Empacota
    log('info', 'Compactando ZIP…');
    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
      (meta) => {
        if (meta.percent && Math.floor(meta.percent) % 25 === 0) {
          log('info', `Compactando: ${Math.floor(meta.percent)}%`);
        }
      }
    );

    log('ok', `Pacote SCORM gerado: ${(blob.size / 1024).toFixed(1)} KB.`);
    return blob;
  }

  // ─── API pública ───────────────────────────────────────────────────
  window.SCORMGenerator = {
    generate,
  };
})();
