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
    <button class="topbar-icon-btn" id="btnSidebar" title="Mostrar/ocultar slides" aria-label="Mostrar/ocultar slides">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <line x1="15" y1="3" x2="15" y2="21"/>
      </svg>
    </button>
    <div class="topbar-title">${title}</div>
    <div class="topbar-progress" id="slideCounter">— / —</div>
    <button class="topbar-icon-btn" id="btnFullscreen" title="Tela cheia" aria-label="Tela cheia">
      <svg class="ic-enter-fs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="4 14 4 20 10 20"/>
        <polyline points="20 10 20 4 14 4"/>
        <line x1="14" y1="10" x2="21" y2="3"/>
        <line x1="3" y1="21" x2="10" y2="14"/>
      </svg>
      <svg class="ic-exit-fs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none">
        <polyline points="9 21 3 21 3 15"/>
        <polyline points="15 3 21 3 21 9"/>
        <line x1="3" y1="21" x2="10" y2="14"/>
        <line x1="14" y1="10" x2="21" y2="3"/>
      </svg>
    </button>
  </header>

  <div class="body">
    <main class="viewport" id="viewport">
      <div class="stage" id="stage" style="width:${stageW}px;height:${stageH}px;">
        <div class="loader">Carregando…</div>
      </div>
    </main>

    <aside class="sidebar" id="sidebar">
      <div class="sidebar-tabs">
        <button class="tab-btn is-active" data-tab="slides">Slides</button>
        <button class="tab-btn" data-tab="notes">Notas</button>
      </div>
      <div class="sidebar-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input type="text" id="searchInput" placeholder="Buscar slide…" autocomplete="off">
      </div>
      <div class="sidebar-content">
        <div class="sidebar-pane" data-pane="slides">
          <div class="sidebar-list" id="slidesList"></div>
        </div>
        <div class="sidebar-pane is-hidden" data-pane="notes">
          <div class="sidebar-list" id="notesList"></div>
        </div>
      </div>
    </aside>
    <div class="sidebar-backdrop" id="sidebarBackdrop"></div>
  </div>

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
    return `/* TONOFF SCORM Player v3 — layout 16:9 + sidebar de slides */
*,*::before,*::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
body {
  background: #0A0E14;
  color: #E8EDF5;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  overscroll-behavior: contain;
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
  gap: 12px;
  padding: 8px 14px;
  background: #11161F;
  border-bottom: 1px solid #2A3447;
  flex-shrink: 0;
  min-height: 48px;
}
.topbar-title {
  flex: 1;
  font-weight: 600;
  font-size: 14px;
  color: #FFB800;
  letter-spacing: 0.3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.topbar-progress {
  font-size: 13px;
  color: #8A95AB;
  font-variant-numeric: tabular-nums;
  letter-spacing: 1px;
  flex-shrink: 0;
}
.topbar-icon-btn {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  background: transparent;
  border: 1px solid transparent;
  color: #8A95AB;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
}
.topbar-icon-btn:hover {
  color: #FFB800;
  border-color: #2A3447;
  background: #1A2130;
}
.topbar-icon-btn svg { width: 18px; height: 18px; }
.topbar-icon-btn.is-active {
  color: #FFB800;
  background: #FFB80015;
  border-color: #FFB80040;
}

/* ─── Body (viewport + sidebar) ─────────────────────────────── */
.body {
  flex: 1;
  display: flex;
  position: relative;
  overflow: hidden;
}

/* ─── Viewport (área do slide com auto-scale) ──────────────── */
.viewport {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: #0A0E14;
  display: flex;
  align-items: center;
  justify-content: center;
}

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
  transition: opacity 0.2s ease;
}
.stage.is-changing { opacity: 0; }

/* Elementos posicionados (em px do PPTX) */
.el { position: absolute; box-sizing: border-box; }
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
.el-image { object-fit: contain; background: transparent; }
.el-shape { /* placeholder pra cor */ }

/* YouTube como thumbnail clicável */
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
.el-youtube.is-floating {
  position: relative;
  width: 480px; height: 270px;
  margin: 16px auto;
  display: flex;
}

.loader, .slide-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #888;
  font-size: 14px;
  letter-spacing: 1px;
}
.slide-empty { font-style: italic; font-size: 18px; }

/* ─── SIDEBAR de slides ──────────────────────────────────────── */
.sidebar {
  /* Desktop default = fechada (sem .is-open) */
  width: 0;
  flex-shrink: 0;
  background: #11161F;
  border-left: 0;
  display: flex;
  flex-direction: column;
  transition: width 0.25s ease, transform 0.25s ease;
  overflow: hidden;
}
.sidebar.is-open {
  width: 280px;
  border-left: 1px solid #2A3447;
}

.sidebar-tabs {
  display: flex;
  border-bottom: 1px solid #2A3447;
  flex-shrink: 0;
}
.tab-btn {
  flex: 1;
  padding: 12px 8px;
  background: transparent;
  border: none;
  color: #8A95AB;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1px;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.15s ease;
  border-bottom: 2px solid transparent;
}
.tab-btn:hover { color: #E8EDF5; }
.tab-btn.is-active {
  color: #FFB800;
  border-bottom-color: #FFB800;
}

.sidebar-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #2A3447;
  flex-shrink: 0;
  background: #0E131C;
}
.sidebar-search svg {
  width: 14px; height: 14px;
  color: #5A6478;
  flex-shrink: 0;
}
.sidebar-search input {
  flex: 1;
  background: transparent;
  border: 0;
  color: #E8EDF5;
  font-family: inherit;
  font-size: 13px;
  outline: none;
}
.sidebar-search input::placeholder { color: #5A6478; }

.sidebar-content {
  flex: 1;
  position: relative;
  overflow: hidden;
}
.sidebar-pane {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  padding: 8px;
}
.sidebar-pane.is-hidden { display: none; }
.sidebar-pane::-webkit-scrollbar { width: 6px; }
.sidebar-pane::-webkit-scrollbar-track { background: #0E131C; }
.sidebar-pane::-webkit-scrollbar-thumb { background: #3D4A63; border-radius: 3px; }

/* Item de slide na sidebar */
.slide-item {
  display: flex;
  gap: 10px;
  padding: 8px;
  border-radius: 4px;
  cursor: pointer;
  margin-bottom: 4px;
  border: 1px solid transparent;
  transition: all 0.15s ease;
}
.slide-item:hover {
  background: #1A2130;
  border-color: #2A3447;
}
.slide-item.is-active {
  background: #FFB80015;
  border-color: #FFB80050;
}
.slide-item.is-hidden { display: none; }

.slide-item-thumb {
  width: 80px;
  aspect-ratio: 16 / 9;
  background: #fff;
  border-radius: 2px;
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
  font-size: 5px;
  display: flex;
  flex-direction: column;
  padding: 4px 5px;
  line-height: 1.1;
  color: #222;
}
.slide-item-thumb-title {
  font-weight: 700;
  color: inherit;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.slide-item-thumb-bar {
  height: 1px;
  background: #FFB800;
  margin: 2px 0 3px;
}
.slide-item-thumb-line {
  background: currentColor;
  opacity: 0.4;
  height: 2px;
  margin-bottom: 2px;
  border-radius: 1px;
}
.slide-item-thumb-line.w70 { width: 70%; }
.slide-item-thumb-line.w90 { width: 90%; }
.slide-item-thumb-line.w50 { width: 50%; }

.slide-item-thumb-icons {
  position: absolute;
  bottom: 3px; right: 3px;
  display: flex;
  gap: 2px;
}
.slide-item-thumb-icons span {
  font-size: 7px;
  background: rgba(0,0,0,0.6);
  color: white;
  padding: 1px 3px;
  border-radius: 2px;
  line-height: 1;
}
.thumb-yt-mini {
  position: absolute;
  inset: 0;
  background: #000 center/cover no-repeat;
  display: flex;
  align-items: center;
  justify-content: center;
}
.thumb-yt-mini::after {
  content: '';
  width: 0; height: 0;
  border-left: 10px solid white;
  border-top: 6px solid transparent;
  border-bottom: 6px solid transparent;
  filter: drop-shadow(0 0 4px rgba(0,0,0,0.8));
}
.thumb-img-mini {
  position: absolute;
  inset: 0;
  background: center/cover no-repeat;
}

.slide-item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}
.slide-item-num {
  font-family: ui-monospace, monospace;
  font-size: 10px;
  color: #5A6478;
  letter-spacing: 1px;
}
.slide-item.is-active .slide-item-num { color: #FFB800; }
.slide-item-title {
  font-size: 12px;
  color: #E8EDF5;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.slide-item-title.is-empty { color: #5A6478; font-style: italic; }

/* Aba Notas */
.note-item {
  padding: 10px 12px;
  border-radius: 4px;
  cursor: pointer;
  margin-bottom: 6px;
  border: 1px solid transparent;
  transition: all 0.15s ease;
}
.note-item:hover { background: #1A2130; border-color: #2A3447; }
.note-item.is-active { background: #FFB80015; border-color: #FFB80050; }
.note-item-num {
  font-family: ui-monospace, monospace;
  font-size: 10px;
  color: #5A6478;
  letter-spacing: 1px;
  margin-bottom: 4px;
}
.note-item.is-active .note-item-num { color: #FFB800; }
.note-item-text {
  font-size: 12px;
  color: #C5CAD6;
  line-height: 1.5;
  white-space: pre-wrap;
}
.notes-empty {
  padding: 32px 16px;
  text-align: center;
  color: #5A6478;
  font-style: italic;
  font-size: 13px;
}

.sidebar-backdrop {
  display: none;
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 5;
}

/* ─── Navbar ─────────────────────────────────────────────────── */
.navbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
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
  flex-shrink: 0;
}
.nav-btn:hover:not(:disabled) {
  border-color: #FFB800;
  color: #FFB800;
}
.nav-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.nav-next {
  background: #FFB800;
  color: #0A0E14;
  border-color: #FFB800;
}
.nav-next:hover:not(:disabled) { background: #FFC833; color: #0A0E14; }
.nav-next.is-finished { background: #4ADE80; border-color: #4ADE80; }

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

/* ─── MOBILE / TABLET (drawer overlay) ───────────────────────── */
@media (max-width: 768px) {
  .topbar { padding: 6px 10px; min-height: 42px; gap: 8px; }
  .topbar-title { font-size: 12px; }
  .topbar-progress { font-size: 11px; }
  .topbar-icon-btn { width: 34px; height: 34px; }

  /* Sidebar usa position:fixed pra escapar do flex parent.
     Default = TOTALMENTE FORA da tela à direita. */
  .sidebar {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: 86%;
    max-width: 320px;
    height: 100%;
    z-index: 100;
    transform: translateX(100%);  /* fora da tela */
    border-left: 1px solid #2A3447;
    box-shadow: -4px 0 24px rgba(0,0,0,0.5);
    transition: transform 0.25s ease;
    overflow: hidden;
  }
  .sidebar.is-open {
    transform: translateX(0);     /* dentro da tela */
  }
  .sidebar-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99;
  }
  .sidebar-backdrop.is-visible {
    display: block;
  }

  .navbar { padding: 8px 10px; gap: 8px; min-height: 50px; }
  .nav-btn { padding: 8px 12px; font-size: 12px; }
  .nav-btn span { display: none; }
}

/* Fullscreen — quando ativo, esconde topbar/footer pra dar mais espaço */
.app:fullscreen .topbar,
.app:fullscreen .navbar {
  /* Mantém visíveis no fullscreen, são úteis */
}
:fullscreen { background: #0A0E14; }`;
  }

  // ─── PLAYER JS ─────────────────────────────────────────────────────
  function buildPlayerJS() {
    return `/* TONOFF SCORM Player v3 · Runtime
   ✓ Layout 16:9 fiel ao PPTX (auto-scale)
   ✓ Sidebar de slides + abas (slides/notas)
   ✓ Search no sidebar
   ✓ Fullscreen API
   ✓ Mobile: sidebar vira drawer
   ✓ YouTube via thumbnail clicável (postMessage __scormOpenURL) */
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
      scormReady = (API.Initialize('') === 'true' || API.Initialize('') === true);
      console.log('[SCORM] API encontrada e inicializada.');
    } catch (e) { console.warn('[SCORM] Initialize:', e); }
  }
  function scormSet(k, v) { if (scormReady) try { API.SetValue(k, String(v)); } catch (e) {} }
  function scormGet(k)    { if (scormReady) try { return API.GetValue(k); } catch (e) {} return ''; }
  function scormCommit()  { if (scormReady) try { API.Commit(''); } catch (e) {} }
  function scormTerminate(){ if (scormReady) try { API.Terminate(''); } catch (e) {} scormReady = false; }

  // ─── Estado ──────────────────────────────────────────────────────
  let slides = [];
  let current = 0;
  let visited = new Set();
  let startTime = Date.now();
  let activeTab = 'slides';

  // ─── Refs ────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const app = $('app');
  const viewport = $('viewport');
  const stage = $('stage');
  const counter = $('slideCounter');
  const fill = $('progressFill');
  const btnPrev = $('btnPrev');
  const btnNext = $('btnNext');
  const btnSidebar = $('btnSidebar');
  const btnFullscreen = $('btnFullscreen');
  const sidebar = $('sidebar');
  const sidebarBackdrop = $('sidebarBackdrop');
  const slidesList = $('slidesList');
  const notesList = $('notesList');
  const searchInput = $('searchInput');

  const STAGE_W = window.__STAGE_W__ || 1280;
  const STAGE_H = window.__STAGE_H__ || 720;

  // ─── Auto-scale do stage ─────────────────────────────────────────
  function updateScale() {
    const padding = 24;
    const vpW = viewport.clientWidth - padding;
    const vpH = viewport.clientHeight - padding;
    if (vpW <= 0 || vpH <= 0) return;
    const scale = Math.min(vpW / STAGE_W, vpH / STAGE_H);
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
  function isMobile() {
    return window.matchMedia('(max-width: 768px)').matches;
  }

  // ─── YouTube: postMessage + fallback nova aba ───────────────────
  window.__abrirVideoYT = function (videoId) {
    const url = 'https://www.youtube.com/watch?v=' + videoId;
    let ackReceived = false;
    const ackListener = (ev) => {
      if (ev.data && ev.data.__scormOpenURL_ack) {
        ackReceived = true;
        window.removeEventListener('message', ackListener);
      }
    };
    window.addEventListener('message', ackListener);
    try {
      let win = window.parent;
      let depth = 0;
      while (win && depth < 12) {
        try { win.postMessage({ __scormOpenURL: true, url: url, videoId: videoId }, '*'); } catch (e) {}
        if (win === win.parent) break;
        win = win.parent;
        depth++;
      }
      if (window.opener) {
        try { window.opener.postMessage({ __scormOpenURL: true, url: url, videoId: videoId }, '*'); } catch (e) {}
      }
    } catch (e) {}
    setTimeout(() => {
      window.removeEventListener('message', ackListener);
      if (!ackReceived) {
        try { window.open(url, '_blank', 'noopener,noreferrer'); } catch (e) {}
      }
    }, 250);
  };

  // ─── Renderização de elementos do slide ─────────────────────────
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
      const thumb = el.thumbnail || ('https://i.ytimg.com/vi/' + el.videoId + '/hqdefault.jpg');
      const bgStyle = 'background-image:url(\\'' + escapeHtml(thumb) + '\\');';
      return (
        '<div class="' + cls + '" style="' + finalCss + bgStyle + '" ' +
             'role="button" tabindex="0" ' +
             'onclick="window.__abrirVideoYT(\\'' + escapeHtml(el.videoId) + '\\')" ' +
             'onkeydown="if(event.key===\\'Enter\\'||event.key===\\' \\'){event.preventDefault();window.__abrirVideoYT(\\'' + escapeHtml(el.videoId) + '\\');}">' +
          '<button type="button" class="yt-play" aria-label="Reproduzir">' +
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

  function renderSlide(i) {
    const s = slides[i];
    if (!s) {
      stage.innerHTML = '<div class="slide-empty">Slide não encontrado.</div>';
      return;
    }
    const positioned = (s.elements || []).filter((e) => !e.unpositioned);
    const floating = (s.elements || []).filter((e) => e.unpositioned);
    let html = positioned.map(renderElement).join('');
    if (floating.length > 0) html += floating.map(renderElement).join('');
    if (!html.trim()) html = '<div class="slide-empty">(slide sem conteúdo identificável)</div>';

    stage.classList.add('is-changing');
    setTimeout(() => {
      stage.style.background = s.bgColor || '#FFFFFF';
      stage.innerHTML = html;
      requestAnimationFrame(() => {
        stage.classList.remove('is-changing');
        updateScale();
      });
    }, 50);
  }

  // ─── SIDEBAR: lista de slides ───────────────────────────────────
  function buildSlideThumb(slide) {
    // Miniatura sintética do slide (16:9)
    const bg = slide.bgColor || '#FFFFFF';
    // Cor do texto baseada no contraste com fundo
    const isDark = bg.length === 7 && (
      parseInt(bg.slice(1,3), 16) + parseInt(bg.slice(3,5), 16) + parseInt(bg.slice(5,7), 16) < 384
    );
    const color = isDark ? '#FFF' : '#222';

    // Procura imagem ou youtube de destaque
    const els = slide.elements || [];
    const yt = els.find((e) => e.type === 'youtube');
    const img = els.find((e) => e.type === 'image');

    if (yt) {
      const ytThumb = yt.thumbnail
        ? escapeHtml(yt.thumbnail)
        : 'https://i.ytimg.com/vi/' + escapeHtml(yt.videoId) + '/default.jpg';
      return '<div class="slide-item-thumb"><div class="thumb-yt-mini" style="background-image:url(\\'' + ytThumb + '\\')"></div></div>';
    }
    if (img && img.src) {
      return '<div class="slide-item-thumb" style="background:' + bg + '"><div class="thumb-img-mini" style="background-image:url(\\'' + escapeHtml(img.src) + '\\')"></div></div>';
    }

    // Layout sintético textual
    const titleHtml = slide.title
      ? '<div class="slide-item-thumb-title" style="color:' + color + '">' + escapeHtml(slide.title.slice(0, 40)) + '</div>' +
        '<div class="slide-item-thumb-bar"></div>'
      : '';
    const lines = (slide.title ? 2 : 3);
    const lineWidths = ['w90', 'w70', 'w50'];
    const linesHtml = Array.from({ length: lines })
      .map((_, i) => '<div class="slide-item-thumb-line ' + (lineWidths[i] || 'w70') + '" style="color:' + color + '"></div>')
      .join('');

    return '<div class="slide-item-thumb" style="background:' + bg + ';color:' + color + '">' +
      titleHtml + linesHtml + '</div>';
  }

  function renderSlidesList() {
    slidesList.innerHTML = slides.map((s, idx) => {
      const num = String(idx + 1).padStart(2, '0');
      const title = s.title || '(sem título)';
      const titleClass = s.title ? '' : ' is-empty';
      return (
        '<div class="slide-item" data-index="' + idx + '" data-search="' + escapeHtml((s.title || '').toLowerCase()) + '">' +
          buildSlideThumb(s) +
          '<div class="slide-item-info">' +
            '<div class="slide-item-num">SLIDE ' + num + '</div>' +
            '<div class="slide-item-title' + titleClass + '">' + escapeHtml(title) + '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    // Click em item → navega
    slidesList.querySelectorAll('.slide-item').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = +el.getAttribute('data-index');
        goto(idx);
        if (isMobile()) closeSidebar();
      });
    });
  }

  function renderNotesList() {
    const notes = slides.map((s, idx) => ({ idx, title: s.title, notes: s.notes }))
      .filter((x) => x.notes && x.notes.trim());
    if (notes.length === 0) {
      notesList.innerHTML = '<div class="notes-empty">Esta apresentação não possui notas do instrutor.</div>';
      return;
    }
    notesList.innerHTML = notes.map((n) => {
      const num = String(n.idx + 1).padStart(2, '0');
      return (
        '<div class="note-item" data-index="' + n.idx + '" data-search="' + escapeHtml((n.notes || '').toLowerCase()) + '">' +
          '<div class="note-item-num">SLIDE ' + num + (n.title ? ' · ' + escapeHtml(n.title) : '') + '</div>' +
          '<div class="note-item-text">' + escapeHtml(n.notes) + '</div>' +
        '</div>'
      );
    }).join('');
    notesList.querySelectorAll('.note-item').forEach((el) => {
      el.addEventListener('click', () => {
        goto(+el.getAttribute('data-index'));
        if (isMobile()) closeSidebar();
      });
    });
  }

  function highlightActiveSidebarItem() {
    slidesList.querySelectorAll('.slide-item').forEach((el) => {
      el.classList.toggle('is-active', +el.getAttribute('data-index') === current);
    });
    notesList.querySelectorAll('.note-item').forEach((el) => {
      el.classList.toggle('is-active', +el.getAttribute('data-index') === current);
    });
    // Scroll automático pra item ativo
    const active = (activeTab === 'slides' ? slidesList : notesList).querySelector('.is-active');
    if (active) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // Tabs
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      activeTab = tab;
      document.querySelectorAll('.tab-btn').forEach((b) =>
        b.classList.toggle('is-active', b.getAttribute('data-tab') === tab)
      );
      document.querySelectorAll('.sidebar-pane').forEach((p) =>
        p.classList.toggle('is-hidden', p.getAttribute('data-pane') !== tab)
      );
      // Re-aplica filtro da busca na aba ativa
      applySearch();
    });
  });

  // Busca
  function applySearch() {
    const q = (searchInput.value || '').trim().toLowerCase();
    const list = (activeTab === 'slides' ? slidesList : notesList);
    list.querySelectorAll('[data-search]').forEach((el) => {
      const matches = !q || el.getAttribute('data-search').includes(q) ||
        el.textContent.toLowerCase().includes(q);
      el.classList.toggle('is-hidden', !matches);
    });
  }
  searchInput.addEventListener('input', applySearch);

  // ─── Sidebar toggle (desktop e mobile usam mesma classe) ────────
  function openSidebar() {
    sidebar.classList.add('is-open');
    if (isMobile()) sidebarBackdrop.classList.add('is-visible');
    btnSidebar.classList.add('is-active');
  }
  function closeSidebar() {
    sidebar.classList.remove('is-open');
    sidebarBackdrop.classList.remove('is-visible');
    btnSidebar.classList.remove('is-active');
  }
  function toggleSidebar() {
    if (sidebar.classList.contains('is-open')) closeSidebar();
    else openSidebar();
    setTimeout(updateScale, 260);
  }
  btnSidebar.addEventListener('click', toggleSidebar);
  sidebarBackdrop.addEventListener('click', closeSidebar);

  // Default: aguarda viewport estabilizar antes de decidir abrir/fechar
  function syncSidebarToViewport() {
    if (!isMobile()) openSidebar();
    else closeSidebar();
  }
  // requestAnimationFrame garante que layout já passou ao menos 1 frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      syncSidebarToViewport();
      updateScale();
    });
  });

  // Quando muda entre mobile e desktop (rotação, etc), reseta estado
  let wasMobile = isMobile();
  window.addEventListener('resize', () => {
    const nowMobile = isMobile();
    if (nowMobile !== wasMobile) {
      wasMobile = nowMobile;
      if (nowMobile) closeSidebar();
      else openSidebar();
    }
    updateScale();
  });

  // ─── Fullscreen API ─────────────────────────────────────────────
  function enterFullscreen() {
    const el = document.documentElement;
    const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (fn) try { fn.call(el); } catch (e) {}
  }
  function exitFullscreen() {
    const fn = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (fn) try { fn.call(document); } catch (e) {}
  }
  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
  }
  btnFullscreen.addEventListener('click', () => {
    if (isFullscreen()) exitFullscreen(); else enterFullscreen();
  });
  document.addEventListener('fullscreenchange', () => {
    const fs = isFullscreen();
    btnFullscreen.querySelector('.ic-enter-fs').style.display = fs ? 'none' : 'block';
    btnFullscreen.querySelector('.ic-exit-fs').style.display = fs ? 'block' : 'none';
    setTimeout(updateScale, 100);
  });

  // ─── Navegação ──────────────────────────────────────────────────
  function goto(i) {
    if (i < 0 || i >= slides.length) return;
    current = i;
    visited.add(i);
    renderSlide(i);
    updateUI();
    saveProgress();
    highlightActiveSidebarItem();
  }
  function updateUI() {
    counter.textContent = (current + 1) + ' / ' + slides.length;
    btnPrev.disabled = current === 0;
    const isLast = current === slides.length - 1;
    btnNext.disabled = isLast;
    fill.style.width = ((visited.size / slides.length) * 100).toFixed(1) + '%';
    btnNext.classList.toggle('is-finished', isLast);
    btnNext.querySelector('span').textContent = isLast ? 'Concluído' : 'Próximo';
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
    scormSet('cmi.session_time', 'PT' + Math.floor(secs/3600) + 'H' + Math.floor((secs%3600)/60) + 'M' + (secs%60) + 'S');
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

  // ─── Listeners ──────────────────────────────────────────────────
  btnPrev.addEventListener('click', () => goto(current - 1));
  btnNext.addEventListener('click', () => goto(current + 1));
  document.addEventListener('keydown', (e) => {
    // Ignora se foco no input de busca
    if (e.target && e.target.tagName === 'INPUT') return;
    if (['ArrowRight','PageDown'].includes(e.key)) {
      e.preventDefault();
      if (current < slides.length - 1) goto(current + 1);
    } else if (['ArrowLeft','PageUp'].includes(e.key)) {
      e.preventDefault();
      if (current > 0) goto(current - 1);
    } else if (e.key === 'f' || e.key === 'F') {
      if (isFullscreen()) exitFullscreen(); else enterFullscreen();
    }
  });
  window.addEventListener('pagehide', () => { saveProgress(); scormTerminate(); });
  window.addEventListener('beforeunload', () => { saveProgress(); scormTerminate(); });
  setInterval(saveProgress, 30000);

  // ─── Bootstrap ───────────────────────────────────────────────────
  console.log('[player] Inicializando…');
  try {
    const data = window.__SLIDES__;
    if (!Array.isArray(data)) throw new Error('window.__SLIDES__ ausente ou inválido');
    slides = data;
    console.log('[player]', slides.length, 'slides carregados.');

    if (!slides.length) {
      stage.innerHTML = '<div class="slide-empty">Apresentação vazia.</div>';
    } else {
      renderSlidesList();
      renderNotesList();
      updateScale();
      const startAt = restoreProgress();
      goto(startAt);
    }
  } catch (err) {
    console.error('[player] Falha ao inicializar:', err);
    stage.innerHTML = '<div class="slide-empty">Erro: ' + (err.message || 'desconhecido') + '</div>';
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
