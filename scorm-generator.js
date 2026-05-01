/* ═══════════════════════════════════════════════════════════════════════
   SCORM-GENERATOR.JS · Empacotador SCORM 2004 4ed (v2)
   ─────────────────────────────────────────────────────────────────────
   Mudanças nesta versão:
   ✓ Layout 16:9 fiel — slides com .slide-stage absoluto em px reais (1280×720)
   ✓ Auto-scale via ResizeObserver pra responsividade
   ✓ YouTube como THUMBNAIL CLICÁVEL (resolve "Erro 153" em iframe blob:)
     → postMessage({__scormOpenURL}) pro parent + fallback window.open
   ✓ CSP meta tag autorizando youtube/youtube-nocookie/ytimg
   ✓ Posicionamento absoluto preservando coordenadas EMU originais

   COMPATÍVEL COM:
     - Plataforma TONOFF (já intercepta __scormOpenURL e abre modal próprio)
     - SCORM Cloud, Moodle, Blackboard
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── Helpers ───────────────────────────────────────────────────────
  const EMU_PER_PX = 9525;
  function emuToPx(emu) { return Math.round((emu || 0) / EMU_PER_PX); }

  function uuid() {
    return 'TONOFF-' + Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2, 10).toUpperCase();
  }

  function escapeXml(s) {
    return String(s == null ? '' : s).replace(/[<>&'"]/g, (c) => ({
      '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
    }[c]));
  }

  function escapeHtmlAttr(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function safeFilename(originalPath) {
    const name = originalPath.split('/').pop();
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    const safe = base
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 60);
    return (safe || 'file') + ext.toLowerCase();
  }

  // ─── Manifest XML ──────────────────────────────────────────────────
  function buildManifest(parsed, opts, fileList) {
    const id = opts.identifier || uuid();
    const title = escapeXml(opts.title || parsed.title || 'Apresentação TONOFF');

    const fileEntries = fileList
      .map((p) => `      <file href="${escapeXml(p)}"/>`).join('\n');

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

  // ─── slides.json — agora inclui ELEMENTS posicionados ─────────────
  function buildSlidesData(parsed, mediaMap) {
    return parsed.slides.map((s) => {
      const elements = (s.elements || []).map((el) => {
        const base = {
          type: el.type,
          x: emuToPx(el.x),
          y: emuToPx(el.y),
          w: emuToPx(el.cx),
          h: emuToPx(el.cy),
        };
        if (el.type === 'text') {
          return {
            ...base,
            isTitle: !!el.isTitle,
            anchor: el.anchor || 't',
            paragraphs: (el.paragraphs || []).map((p) => ({
              text: p.text || '',
              fontSize: p.fontSize || null,
              bold: !!p.bold,
              italic: !!p.italic,
              color: p.color || null,
              align: p.align || 'l',
              isBullet: !!p.isBullet,
              indent: p.indent || 0,
            })),
          };
        }
        if (el.type === 'image') {
          return { ...base, src: mediaMap[el.path] || null };
        }
        if (el.type === 'youtube') {
          return {
            ...base,
            videoId: el.videoId,
            url: 'https://www.youtube.com/watch?v=' + el.videoId,
            thumbnail: el.thumbnailPath ? (mediaMap[el.thumbnailPath] || null) : null,
          };
        }
        if (el.type === 'shape') {
          return { ...base, fill: el.fill || null };
        }
        return base;
      }).filter((el) => el.type !== 'image' || el.src); // remove imagem sem src

      // YouTube de hyperlinks (sem posição) entra como elemento extra no fim
      const positionedYtIds = new Set(
        elements.filter((e) => e.type === 'youtube').map((e) => e.videoId)
      );
      (s.youtubeVideos || []).forEach((yt) => {
        if (!positionedYtIds.has(yt.videoId)) {
          elements.push({
            type: 'youtube',
            x: 0, y: 0, w: 0, h: 0, // sem posição → renderizado como bloco no final
            videoId: yt.videoId,
            url: 'https://www.youtube.com/watch?v=' + yt.videoId,
            thumbnail: null,
            unpositioned: true,
          });
        }
      });

      return {
        index: s.index,
        title: s.title || '',
        bgColor: s.bgColor || null,
        elements,
        notes: s.notes || '',
      };
    });
  }

  // ─── PLAYER HTML ───────────────────────────────────────────────────
  // CRÍTICO: slides.json é embutido INLINE como window.__SLIDES__.
  // Em iframe blob: (plataformas EAD), fetch('slides.json') resolve pra
  // blob:.../slides.json e cai no early return dos hooks → loading infinito.
  // Embutir inline elimina o fetch e funciona em qualquer ambiente.
  function buildPlayerHTML(parsed, opts, slideSize, slidesData) {
    const title = escapeXml(opts.title || parsed.title || 'Apresentação TONOFF');
    const stageW = emuToPx(slideSize.cx);
    const stageH = emuToPx(slideSize.cy);

    // Serializa slidesData de forma SEGURA dentro de <script>.
    // Trocar </script> por <\/script> evita escape do bloco.
    const slidesJson = JSON.stringify(slidesData)
      .replace(/<\/(script)/gi, '<\\/$1')
      .replace(/<!--/g, '<\\!--');

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' blob: data:; script-src 'self' 'unsafe-inline' blob: data:; style-src 'self' 'unsafe-inline' blob: data:; frame-src 'self' blob: data: https://www.youtube.com https://www.youtube-nocookie.com https://i.ytimg.com https://s.ytimg.com https://player.vimeo.com; img-src 'self' blob: data: https: http:; media-src 'self' blob: data: https:; connect-src 'self' blob: data:;">
<title>${title}</title>
<link rel="stylesheet" href="player.css">
<script>
// Stage size derivado do PPTX (em px, 96dpi)
window.__STAGE_W__ = ${stageW};
window.__STAGE_H__ = ${stageH};
// Slides EMBUTIDOS — disponível antes do player.js carregar
window.__SLIDES__ = ${slidesJson};
</script>
</head>
<body>
<div id="app" class="app">

  <header class="topbar">
    <div class="topbar-title">${title}</div>
    <div class="topbar-progress" id="slideCounter">— / —</div>
  </header>

  <main class="viewport" id="viewport">
    <div class="stage" id="stage" style="width:${stageW}px;height:${stageH}px;">
      <div class="loader">Carregando…</div>
    </div>
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
    return `/* TONOFF SCORM Player v2 — layout 16:9 fiel ao PPTX */
*,*::before,*::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
body {
  background: #0A0E14;
  color: #E8EDF5;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
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
  padding: 10px 20px;
  background: #11161F;
  border-bottom: 1px solid #2A3447;
  flex-shrink: 0;
  min-height: 44px;
}
.topbar-title {
  font-weight: 600;
  font-size: 14px;
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

/* ─── Viewport (área externa que escala) ─────────────────────── */
.viewport {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: #0A0E14;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Stage = slide com dimensões REAIS (1280×720 etc).
   A escala é feita por CSS variable --scale ajustada pelo JS via ResizeObserver. */
.stage {
  position: absolute;
  background: #FFFFFF;
  color: #1A1A1A;
  overflow: hidden;
  transform-origin: center center;
  transform: translate(-50%, -50%) scale(var(--scale, 1));
  left: 50%;
  top: 50%;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
}

/* Animação de entrada do slide */
.stage.is-changing { opacity: 0; }
.stage { transition: opacity 0.2s ease; }

/* ─── Elementos do slide (todos absolute, em px do PPTX) ────── */
.el {
  position: absolute;
  box-sizing: border-box;
}

.el-text {
  padding: 4px 6px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.el-text.anchor-t { justify-content: flex-start; }
.el-text.anchor-ctr { justify-content: center; }
.el-text.anchor-b { justify-content: flex-end; }
.el-text p {
  margin: 0;
  line-height: 1.25;
  word-wrap: break-word;
  overflow-wrap: break-word;
}
.el-text p + p { margin-top: 0.3em; }

.el-image {
  object-fit: contain;
  background: transparent;
}

.el-shape {
  /* faixas/retângulos coloridos decorativos */
}

/* YouTube como thumbnail clicável (evita Erro 153 em iframe blob:) */
.el-youtube {
  background: #000 center/cover no-repeat;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: filter 0.15s ease;
}
.el-youtube:hover { filter: brightness(1.1); }
.el-youtube .yt-play {
  width: 68px; height: 48px;
  background: rgba(220, 38, 38, 0.92);
  border: none;
  border-radius: 12px;
  cursor: pointer;
  display: grid;
  place-items: center;
  box-shadow: 0 4px 14px rgba(0,0,0,0.5);
  transition: transform 0.15s ease, background 0.15s ease;
  pointer-events: none;
}
.el-youtube:hover .yt-play {
  background: rgba(220, 38, 38, 1);
  transform: scale(1.05);
}
.el-youtube .yt-play svg { width: 24px; height: 24px; fill: #FFFFFF; }
.el-youtube .yt-label {
  position: absolute;
  bottom: 8px; left: 8px;
  background: rgba(0,0,0,0.7);
  color: white;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 2px;
  letter-spacing: 0.5px;
  pointer-events: none;
}

/* YouTube extra (vídeos sem posição — vindos de hyperlink em texto) */
.el-youtube.is-floating {
  position: relative;
  width: 480px; height: 270px;
  margin: 16px auto;
  display: flex;
}

.loader {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #999;
  font-size: 14px;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.slide-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #aaa;
  font-style: italic;
  font-size: 18px;
}

/* Notas (renderizadas FORA do stage, abaixo do viewport) — ficam ocultas no player default */
.slide-notes-overlay {
  display: none;
}

/* ─── Navbar ─────────────────────────────────────────────────── */
.navbar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 20px;
  background: #11161F;
  border-top: 1px solid #2A3447;
  flex-shrink: 0;
  min-height: 56px;
}

.nav-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
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

/* ─── Mobile ─────────────────────────────────────────────────── */
@media (max-width: 640px) {
  .topbar { padding: 8px 12px; min-height: 38px; }
  .topbar-title { font-size: 12px; max-width: 60%; }
  .navbar { padding: 8px 10px; gap: 8px; min-height: 48px; }
  .nav-btn { padding: 7px 10px; font-size: 12px; }
  .nav-btn span { display: none; }
}`;
  }

  // ─── PLAYER JS ─────────────────────────────────────────────────────
  function buildPlayerJS() {
    return `/* TONOFF SCORM Player v2 · Runtime */
(function () {
  'use strict';

  // ─── Localiza API SCORM 2004 ─────────────────────────────────────
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
  const viewport = document.getElementById('viewport');
  const stage = document.getElementById('stage');
  const counter = document.getElementById('slideCounter');
  const fill = document.getElementById('progressFill');
  const btnPrev = document.getElementById('btnPrev');
  const btnNext = document.getElementById('btnNext');

  const STAGE_W = window.__STAGE_W__ || 1280;
  const STAGE_H = window.__STAGE_H__ || 720;

  // ─── Auto-scale do stage ─────────────────────────────────────────
  function updateScale() {
    const padding = 24; // respiro nas bordas
    const vpW = viewport.clientWidth - padding;
    const vpH = viewport.clientHeight - padding;
    if (vpW <= 0 || vpH <= 0) return;
    const scaleW = vpW / STAGE_W;
    const scaleH = vpH / STAGE_H;
    const scale = Math.min(scaleW, scaleH);
    stage.style.setProperty('--scale', scale.toFixed(4));
  }

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(updateScale).observe(viewport);
  } else {
    window.addEventListener('resize', updateScale);
  }

  // ─── Helpers ─────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ─── YouTube: abre vídeo externamente (resolve "Erro 153") ──────
  // Estratégia: postMessage pro parent (TONOFF intercepta e abre modal),
  // com fallback de abrir nova aba após 250ms se ninguém respondeu.
  window.__abrirVideoYT = function (videoId) {
    const url = 'https://www.youtube.com/watch?v=' + videoId;
    let ackReceived = false;

    // Listener de ACK opcional — plataformas podem responder
    const ackListener = function (ev) {
      if (ev.data && ev.data.__scormOpenURL_ack) {
        ackReceived = true;
        window.removeEventListener('message', ackListener);
      }
    };
    window.addEventListener('message', ackListener);

    // PostMessage pro parent (qualquer profundidade)
    try {
      let win = window.parent;
      let depth = 0;
      while (win && depth < 12) {
        try {
          win.postMessage({ __scormOpenURL: true, url: url, videoId: videoId }, '*');
        } catch (e) {}
        if (win === win.parent) break;
        win = win.parent;
        depth++;
      }
      if (window.opener) {
        try { window.opener.postMessage({ __scormOpenURL: true, url: url, videoId: videoId }, '*'); }
        catch (e) {}
      }
    } catch (e) { console.warn('postMessage falhou:', e); }

    // Fallback: nova aba se ninguém responder em 250ms
    setTimeout(function () {
      window.removeEventListener('message', ackListener);
      if (!ackReceived) {
        try { window.open(url, '_blank', 'noopener,noreferrer'); }
        catch (e) { console.warn('window.open falhou:', e); }
      }
    }, 250);
  };

  // ─── Renderização de elementos posicionados ─────────────────────
  function renderElement(el) {
    const css = 'left:' + el.x + 'px;top:' + el.y + 'px;width:' + el.w + 'px;height:' + el.h + 'px;';

    if (el.type === 'text') {
      const anchorClass = 'anchor-' + (el.anchor || 't');
      const inner = (el.paragraphs || []).map(function (p) {
        const styles = [];
        if (p.fontSize) styles.push('font-size:' + p.fontSize + 'pt');
        if (p.bold) styles.push('font-weight:700');
        if (p.italic) styles.push('font-style:italic');
        if (p.color) styles.push('color:' + p.color);
        const alignMap = { l: 'left', ctr: 'center', r: 'right', just: 'justify' };
        styles.push('text-align:' + (alignMap[p.align] || 'left'));
        const text = p.isBullet ? '• ' + p.text : p.text;
        return '<p style="' + styles.join(';') + '">' + escapeHtml(text) + '</p>';
      }).join('');
      return '<div class="el el-text ' + anchorClass + '" style="' + css + '">' + inner + '</div>';
    }

    if (el.type === 'image') {
      return '<img class="el el-image" style="' + css + '" src="' + escapeHtml(el.src) + '" alt="">';
    }

    if (el.type === 'youtube') {
      const isFloating = el.unpositioned || (!el.w && !el.h);
      const cls = 'el el-youtube' + (isFloating ? ' is-floating' : '');
      const finalCss = isFloating ? '' : css;
      // Thumbnail: usa imagem embutida se houver, senão pega do YouTube CDN
      const thumb = el.thumbnail || ('https://i.ytimg.com/vi/' + el.videoId + '/hqdefault.jpg');
      const bgStyle = 'background-image:url(\\'' + escapeHtml(thumb) + '\\');';
      return (
        '<div class="' + cls + '" style="' + finalCss + bgStyle + '" ' +
             'role="button" tabindex="0" ' +
             'onclick="window.__abrirVideoYT(\\'' + escapeHtml(el.videoId) + '\\')" ' +
             'onkeydown="if(event.key===\\'Enter\\'||event.key===\\' \\'){event.preventDefault();window.__abrirVideoYT(\\'' + escapeHtml(el.videoId) + '\\');}">' +
          '<button type="button" class="yt-play" aria-label="Reproduzir vídeo no YouTube">' +
            '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>' +
          '</button>' +
          '<span class="yt-label">▶ ' + escapeHtml(el.videoId) + '</span>' +
        '</div>'
      );
    }

    if (el.type === 'shape') {
      const bg = el.fill ? 'background:' + el.fill + ';' : '';
      return '<div class="el el-shape" style="' + css + bg + '"></div>';
    }

    return '';
  }

  // ─── Renderização de slide completo ─────────────────────────────
  function renderSlide(i) {
    const s = slides[i];
    if (!s) {
      stage.innerHTML = '<div class="slide-empty">Slide não encontrado.</div>';
      return;
    }
    const positioned = (s.elements || []).filter(function (e) { return !e.unpositioned; });
    const floating = (s.elements || []).filter(function (e) { return e.unpositioned; });

    let html = positioned.map(renderElement).join('');

    // Vídeos do YouTube vindos de hyperlinks (sem posição) → centraliza
    if (floating.length > 0) {
      html += floating.map(renderElement).join('');
    }

    if (!html.trim()) {
      html = '<div class="slide-empty">(slide sem conteúdo identificável)</div>';
    }

    // Animação de troca
    stage.classList.add('is-changing');
    setTimeout(function () {
      // Cor de fundo do slide (do PPTX) — fallback branco
      stage.style.background = s.bgColor || '#FFFFFF';
      stage.innerHTML = html;
      requestAnimationFrame(function () {
        stage.classList.remove('is-changing');
        updateScale();
      });
    }, 50);
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

  // ─── SCORM persistence ──────────────────────────────────────────
  function saveProgress() {
    scormSet('cmi.location', String(current));
    const progress = visited.size / slides.length;
    scormSet('cmi.progress_measure', progress.toFixed(4));
    if (progress >= 0.95) {
      scormSet('cmi.completion_status', 'completed');
      scormSet('cmi.success_status', 'passed');
      scormSet('cmi.score.scaled', '1');
    } else {
      scormSet('cmi.completion_status', 'incomplete');
    }
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
      if (!isNaN(idx) && idx >= 0 && idx < slides.length) return idx;
    }
    return 0;
  }

  // ─── Event listeners ────────────────────────────────────────────
  btnPrev.addEventListener('click', function () { goto(current - 1); });
  btnNext.addEventListener('click', function () { goto(current + 1); });

  document.addEventListener('keydown', function (e) {
    if (['ArrowRight','PageDown'].includes(e.key)) {
      e.preventDefault();
      if (current < slides.length - 1) goto(current + 1);
    } else if (['ArrowLeft','PageUp'].includes(e.key)) {
      e.preventDefault();
      if (current > 0) goto(current - 1);
    }
  });

  window.addEventListener('pagehide', function () {
    saveProgress();
    scormTerminate();
  });
  window.addEventListener('beforeunload', function () {
    saveProgress();
    scormTerminate();
  });

  setInterval(saveProgress, 30000);

  // ─── Bootstrap ───────────────────────────────────────────────────
  // Lê slides EMBUTIDOS no HTML (window.__SLIDES__).
  // Não usa fetch porque iframe blob: tem origin null e fetch falha.
  console.log('[player] Inicializando…');
  try {
    const data = window.__SLIDES__;
    if (!Array.isArray(data)) {
      throw new Error('window.__SLIDES__ ausente ou inválido');
    }
    slides = data;
    console.log('[player]', slides.length, 'slides carregados.');

    if (!slides.length) {
      stage.innerHTML = '<div class="slide-empty">Apresentação vazia.</div>';
    } else {
      updateScale();
      const startAt = restoreProgress();
      goto(startAt);
    }
  } catch (err) {
    console.error('[player] Falha ao inicializar:', err);
    stage.innerHTML = '<div class="slide-empty">Erro ao carregar conteúdo: ' +
      (err && err.message ? err.message : 'desconhecido') + '</div>';
  }
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

    const slideSize = parsed.slideSize || { cx: 12192000, cy: 6858000 };
    const stageW = emuToPx(slideSize.cx);
    const stageH = emuToPx(slideSize.cy);
    log('info', `Stage real: ${stageW}×${stageH}px (${slideSize.cx}×${slideSize.cy} EMU)`);

    const zip = new JSZip();

    // 1. Mídia
    log('info', 'Copiando arquivos de mídia para o pacote…');
    const mediaList = [];
    const mediaMap = {};
    const usedNames = new Set();

    for (const [origPath, blob] of Object.entries(parsed.mediaFiles || {})) {
      let safe = safeFilename(origPath);
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
      mediaList.push(scormPath);
      mediaMap[origPath] = scormPath;
    }
    log('ok', `${mediaList.length} arquivo(s) de mídia copiado(s).`);

    // 2. slides.json (também salvo como arquivo, mas o player usa o EMBUTIDO no HTML)
    log('info', 'Gerando slides.json com elementos posicionados…');
    const slidesData = buildSlidesData(parsed, mediaMap);
    zip.file('slides.json', JSON.stringify(slidesData, null, 2));

    // 3. Player
    log('info', 'Gerando player SCORM (HTML/CSS/JS) com slides embutidos…');
    zip.file('index.html', buildPlayerHTML(parsed, opts, slideSize, slidesData));
    zip.file('player.css', buildPlayerCSS());
    zip.file('player.js', buildPlayerJS());

    // 4. Manifest
    log('info', 'Gerando imsmanifest.xml…');
    const allFiles = ['index.html', 'player.css', 'player.js', 'slides.json', ...mediaList];
    zip.file('imsmanifest.xml', buildManifest(parsed, opts, allFiles));

    // 5. ZIP
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

  window.SCORMGenerator = {
    generate,
    _utils: { emuToPx, safeFilename, EMU_PER_PX },
  };
})();
