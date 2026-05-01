/* ═══════════════════════════════════════════════════════════════════════
   CONVERTER.JS · Orquestrador principal · PPTX → SCORM
   ─────────────────────────────────────────────────────────────────────
   Pipeline:
   1. Upload (drag&drop ou input) → validar PPTX → quick scan → painel
   2. Botão "Analisar conteúdo" → PPTXParser → renderiza preview de slides
   3. Botão "Gerar pacote SCORM" → SCORMGenerator (passo 3, ainda placeholder)
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── Estado em memória ─────────────────────────────────────────────
  const state = {
    file: null,
    zip: null,
    stats: null,
    parsed: null,
    objectURLs: [],   // pra revogar ao resetar (thumbnails de imagens)
  };

  // ─── DOM refs ──────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const dropzone     = $('dropzone');
  const fileInput    = $('fileInput');
  const btnPickFile  = $('btnPickFile');
  const panel        = $('panel');
  const panelStatus  = $('panelStatus');
  const fileName     = $('fileName');
  const fileSize     = $('fileSize');
  const statSlides   = $('statSlides');
  const statImages   = $('statImages');
  const statMedia    = $('statMedia');
  const statSize     = $('statSize');
  const logBlock     = $('logBlock');
  const btnAnalyze   = $('btnAnalyze');
  const btnReset     = $('btnReset');
  const preview      = $('preview');
  const previewStats = $('previewStats');
  const slidesGrid   = $('slidesGrid');
  const btnGenerate  = $('btnGenerate');
  const generateHint = $('generateHint');

  // ─── Logger visual ─────────────────────────────────────────────────
  function log(level, msg) {
    const time = new Date().toLocaleTimeString('pt-BR', { hour12: false });
    const line = document.createElement('div');
    line.className = 'log-line';
    line.innerHTML =
      `<span class="log-time">${time}</span>` +
      `<span class="log-tag ${level}">${level.toUpperCase()}</span>` +
      `<span class="log-msg">${escapeHtml(msg)}</span>`;
    logBlock.appendChild(line);
    logBlock.scrollTop = logBlock.scrollHeight;
    const fn = level === 'err' ? 'error' : level === 'warn' ? 'warn' : 'log';
    console[fn](`[converter] ${msg}`);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  // ─── Helpers UI ────────────────────────────────────────────────────
  function setStatus(text, mode) {
    panelStatus.textContent = text;
    panelStatus.classList.remove('is-busy', 'is-error');
    if (mode) panelStatus.classList.add(mode);
  }
  function showPanel()    { panel.classList.add('is-visible'); }
  function hidePanel()    { panel.classList.remove('is-visible'); }
  function showPreview()  { preview.classList.add('is-visible'); }
  function hidePreview()  { preview.classList.remove('is-visible'); }
  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function resetState() {
    state.file = null;
    state.zip = null;
    state.stats = null;
    state.parsed = null;
    // Revoga ObjectURLs de thumbnails pra liberar memória
    state.objectURLs.forEach((url) => URL.revokeObjectURL(url));
    state.objectURLs = [];

    fileInput.value = '';
    statSlides.textContent = '—';
    statImages.textContent = '—';
    statMedia.textContent  = '—';
    statSize.textContent   = '—';
    logBlock.innerHTML = '';
    slidesGrid.innerHTML = '';
    previewStats.textContent = '—';
    btnAnalyze.disabled = true;
    btnGenerate.disabled = true;
    hidePanel();
    hidePreview();
  }

  function openFilePicker() { fileInput.click(); }

  // ─── Drag & drop ───────────────────────────────────────────────────
  ['dragenter', 'dragover'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.add('is-drag');
    });
  });
  ['dragleave', 'drop'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.remove('is-drag');
    });
  });
  dropzone.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  dropzone.addEventListener('click', (e) => {
    if (e.target.closest('#btnPickFile')) return;
    openFilePicker();
  });
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); openFilePicker();
    }
  });
  btnPickFile.addEventListener('click', (e) => {
    e.stopPropagation(); openFilePicker();
  });
  fileInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) handleFile(f);
  });

  // Bloqueia drop fora da dropzone
  ['dragover', 'drop'].forEach(evt => {
    window.addEventListener(evt, (e) => {
      if (!e.target.closest || !e.target.closest('#dropzone')) e.preventDefault();
    }, false);
  });

  // ─── Botões ────────────────────────────────────────────────────────
  btnReset.addEventListener('click', () => {
    resetState();
    log('info', 'Estado resetado. Pronto para novo arquivo.');
  });

  btnAnalyze.addEventListener('click', () => {
    if (!state.zip) return;
    runAnalysis();
  });

  btnGenerate.addEventListener('click', () => {
    if (!state.parsed) return;
    runGenerate();
  });

  // ─── PASSO 3: Gerar pacote SCORM ─────────────────────────────────
  async function runGenerate() {
    if (typeof window.SCORMGenerator === 'undefined') {
      log('err', 'SCORMGenerator não carregado.');
      return;
    }
    btnGenerate.disabled = true;
    setStatus('GERANDO SCORM', 'is-busy');
    log('info', 'Iniciando geração do pacote SCORM 2004 4ed…');

    try {
      const opts = {
        title: state.parsed.title || (state.file && state.file.name.replace(/\.pptx$/i, '')) || 'Apresentação TONOFF',
      };
      const blob = await window.SCORMGenerator.generate(state.parsed, opts, log);

      // Dispara download
      const baseName = (state.file ? state.file.name.replace(/\.pptx$/i, '') : 'tonoff-scorm');
      const filename = baseName.replace(/[^a-zA-Z0-9_-]/g, '_') + '_SCORM.zip';
      downloadBlob(blob, filename);
      log('ok', `Download iniciado: ${filename}`);
      setStatus('SCORM GERADO');
    } catch (err) {
      log('err', 'Falha ao gerar SCORM: ' + err.message);
      console.error(err);
      setStatus('FALHA NA GERAÇÃO', 'is-error');
    } finally {
      btnGenerate.disabled = false;
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }

  // ─── Pipeline upload + quick scan (passo 1 — inalterado) ───────────
  async function handleFile(file) {
    resetState();
    state.file = file;

    fileName.textContent = file.name;
    fileSize.textContent = fmtBytes(file.size);
    statSize.textContent = fmtBytes(file.size);
    showPanel();
    setStatus('ANALISANDO', 'is-busy');

    log('info', `Arquivo recebido: ${file.name} (${fmtBytes(file.size)})`);

    if (!file.name.toLowerCase().endsWith('.pptx')) {
      setStatus('ARQUIVO INVÁLIDO', 'is-error');
      log('err', 'Extensão não é .pptx.');
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setStatus('ARQUIVO MUITO GRANDE', 'is-error');
      log('err', 'Arquivo excede o limite de 100 MB.');
      return;
    }
    if (typeof JSZip === 'undefined') {
      setStatus('LIB NÃO CARREGADA', 'is-error');
      log('err', 'JSZip não disponível.');
      return;
    }

    try {
      log('info', 'Lendo bytes do arquivo…');
      const buffer = await file.arrayBuffer();
      log('info', 'Decompactando estrutura interna do PPTX (OOXML)…');
      const zip = await JSZip.loadAsync(buffer);
      state.zip = zip;
      log('ok', `ZIP aberto. ${Object.keys(zip.files).length} entradas encontradas.`);
    } catch (err) {
      setStatus('ZIP CORROMPIDO', 'is-error');
      log('err', 'Não foi possível ler como ZIP.');
      console.error(err);
      return;
    }

    if (!state.zip.file('ppt/presentation.xml')) {
      setStatus('NÃO É UM PPTX', 'is-error');
      log('err', 'Estrutura interna não corresponde a um arquivo PPTX.');
      return;
    }
    log('ok', 'Estrutura PPTX validada.');

    try {
      const stats = quickScan(state.zip);
      state.stats = stats;
      statSlides.textContent = String(stats.slideCount);
      statImages.textContent = String(stats.imageCount);
      statMedia.textContent  = String(stats.mediaCount);

      log('ok', `Detectados ${stats.slideCount} slide(s).`);
      if (stats.imageCount) log('info', `${stats.imageCount} imagem(ns) embutidas.`);
      if (stats.mediaCount) log('info', `${stats.mediaCount} mídia(s) (vídeo/áudio).`);
    } catch (err) {
      log('warn', 'Falha ao coletar estatísticas.');
      console.error(err);
    }

    setStatus('PRONTO PARA ANÁLISE');
    btnAnalyze.disabled = false;
    log('ok', 'Análise inicial concluída. Clique em "Analisar conteúdo".');
  }

  function quickScan(zip) {
    let slideCount = 0, imageCount = 0, mediaCount = 0;
    Object.keys(zip.files).forEach((path) => {
      if (/^ppt\/slides\/slide\d+\.xml$/i.test(path)) slideCount++;
      if (/^ppt\/media\//i.test(path) && !path.endsWith('/')) {
        const ext = path.split('.').pop().toLowerCase();
        if (['png','jpg','jpeg','gif','bmp','tiff','svg','emf','wmf'].includes(ext)) imageCount++;
        else if (['mp4','m4v','mov','avi','wmv','mp3','m4a','wav','ogg'].includes(ext)) mediaCount++;
      }
    });
    return { slideCount, imageCount, mediaCount };
  }

  // ─── PASSO 2: Análise OOXML completa ───────────────────────────────
  async function runAnalysis() {
    if (typeof window.PPTXParser === 'undefined') {
      log('err', 'PPTXParser não carregado.');
      return;
    }
    setStatus('PARSEANDO SLIDES', 'is-busy');
    btnAnalyze.disabled = true;

    try {
      const parsed = await window.PPTXParser.parse(state.zip, log);
      state.parsed = parsed;
      renderPreview(parsed);
      setStatus('CONTEÚDO EXTRAÍDO');
      btnGenerate.disabled = false;   // habilita placeholder do passo 3
      btnAnalyze.disabled = false;    // permite re-analisar
    } catch (err) {
      setStatus('FALHA NA ANÁLISE', 'is-error');
      log('err', 'Falha ao parsear: ' + err.message);
      console.error(err);
      btnAnalyze.disabled = false;
    }
  }

  // ─── Renderização do preview de slides ─────────────────────────────
  function renderPreview(parsed) {
    // Stats no topo do preview
    const bits = [
      `<strong>${parsed.slideCount}</strong> slide${parsed.slideCount !== 1 ? 's' : ''}`,
      `<strong>${parsed.totalImages}</strong> imagens`,
      `<strong>${parsed.totalYouTube}</strong> vídeos YouTube`,
      `<strong>${parsed.totalWords}</strong> palavras`,
    ];
    previewStats.innerHTML = bits.join(' · ');

    // Detecta imagens "decorativas" (logos repetidas) — aparecem em ≥ 50% dos slides
    const imageOccurrences = new Map();
    parsed.slides.forEach((s) => {
      const seen = new Set();
      s.images.forEach((img) => {
        if (seen.has(img.path)) return;
        seen.add(img.path);
        imageOccurrences.set(img.path, (imageOccurrences.get(img.path) || 0) + 1);
      });
    });
    const decorativeThreshold = Math.max(2, Math.ceil(parsed.slides.length * 0.5));
    const decorativeImages = new Set();
    imageOccurrences.forEach((count, path) => {
      if (count >= decorativeThreshold) decorativeImages.add(path);
    });
    if (decorativeImages.size > 0) {
      log('info', `Identificadas ${decorativeImages.size} imagem(ns) decorativas (logos/rodapés).`);
    }

    // Cards
    slidesGrid.innerHTML = '';
    parsed.slides.forEach((slide) => {
      slidesGrid.appendChild(buildSlideCard(slide, parsed.mediaFiles, parsed.slideSize, decorativeImages));
    });

    // Zona de geração
    if (parsed.totalYouTube > 0) {
      generateHint.innerHTML =
        `Pronto para empacotar com <strong>${parsed.totalYouTube} vídeo(s) do YouTube</strong> ` +
        `usando iframe simples (sem "Erro 153").`;
    } else {
      generateHint.innerHTML = 'Pronto para empacotar. <strong>Clique abaixo para baixar o .zip</strong>.';
    }

    showPreview();

    // Scroll suave até o preview
    setTimeout(() => preview.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }

  function buildSlideCard(slide, mediaFiles, slideSize, decorativeImages) {
    const card = document.createElement('article');
    card.className = 'slide-card' + (slide.error ? ' is-error' : '');

    // Header com número e flags
    const flags = [];
    const contentImages = slide.images.filter((img) => !decorativeImages.has(img.path));
    const decoCount = slide.images.length - contentImages.length;

    if (contentImages.length) flags.push(`<span class="flag is-img">${contentImages.length} IMG</span>`);
    if (decoCount > 0) flags.push(`<span class="flag is-deco" title="Imagens repetidas em vários slides (provável logo/rodapé)">${decoCount} LOGO</span>`);
    if (slide.youtubeVideos.length) flags.push(`<span class="flag is-yt">▶ ${slide.youtubeVideos.length} YT</span>`);
    if (slide.notes) flags.push(`<span class="flag is-notes">📝</span>`);

    const indexNum = String(slide.index).padStart(2, '0');
    card.innerHTML = `
      <header class="slide-card-header">
        <span><span class="slide-card-num">SLIDE ${indexNum}</span></span>
        <span class="slide-card-flags">${flags.join('')}</span>
      </header>
    `;

    // Miniatura sintética 16:9 (ou proporção real do slide)
    const thumb = buildSlideThumbnail(slide, contentImages, mediaFiles, slideSize);
    card.appendChild(thumb);

    // Body com info textual
    const body = document.createElement('div');
    body.className = 'slide-card-body';

    if (slide.title) {
      const t = document.createElement('div');
      t.className = 'slide-title';
      t.textContent = slide.title;
      body.appendChild(t);
    } else if (slide.error) {
      const t = document.createElement('div');
      t.className = 'slide-title is-empty';
      t.textContent = '⚠️ Erro: ' + slide.error;
      body.appendChild(t);
    } else if (!slide.paragraphs.length && !slide.images.length) {
      const t = document.createElement('div');
      t.className = 'slide-title is-empty';
      t.textContent = '(slide sem texto identificável)';
      body.appendChild(t);
    }

    if (slide.paragraphs.length > 0) {
      const txt = document.createElement('div');
      txt.className = 'slide-text';
      txt.textContent = slide.paragraphs.join(' / ');
      body.appendChild(txt);
    }

    if (slide.youtubeVideos.length > 0) {
      const list = document.createElement('div');
      list.className = 'slide-yt-list';
      slide.youtubeVideos.forEach((yt) => {
        const a = document.createElement('a');
        a.className = 'slide-yt-link';
        a.href = `https://www.youtube.com/watch?v=${yt.videoId}`;
        a.target = '_blank';
        a.rel = 'noopener';
        a.innerHTML =
          `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
            <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.6 15.6V8.4l6.2 3.6-6.2 3.6z"/>
          </svg>` +
          `<span>${yt.videoId}</span>`;
        list.appendChild(a);
      });
      body.appendChild(list);
    }

    if (slide.notes) {
      const n = document.createElement('div');
      n.className = 'slide-notes';
      n.textContent = slide.notes;
      body.appendChild(n);
    }

    card.appendChild(body);
    return card;
  }

  // ─── Miniatura SVG sintética 16:9 ──────────────────────────────────
  // Renderiza o slide como ele será visto no SCORM final (proporção real)
  function buildSlideThumbnail(slide, contentImages, mediaFiles, slideSize) {
    const wrap = document.createElement('div');
    wrap.className = 'slide-thumbnail';

    // Aspect ratio real do slide (default 16:9)
    const ratio = (slideSize && slideSize.cx && slideSize.cy)
      ? (slideSize.cy / slideSize.cx) * 100
      : 56.25;
    wrap.style.paddingBottom = ratio.toFixed(2) + '%';

    const inner = document.createElement('div');
    inner.className = 'slide-thumbnail-inner';

    // Caso 1: tem vídeo do YouTube → mostra "letterbox" com play button
    if (slide.youtubeVideos.length > 0) {
      const yt = slide.youtubeVideos[0];
      inner.innerHTML = `
        <div class="thumb-yt">
          <img class="thumb-yt-poster" src="https://i.ytimg.com/vi/${yt.videoId}/hqdefault.jpg"
               alt="" loading="lazy" onerror="this.style.display='none'">
          <div class="thumb-yt-play">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </div>
        </div>
      `;
    }
    // Caso 2: tem imagem de conteúdo → mostra a maior
    else if (contentImages.length > 0) {
      // Pega a maior por área (cx*cy em EMU); se EMU não disponível, primeira
      let main = contentImages[0];
      if (main.cx && main.cy) {
        main = contentImages.reduce((best, img) =>
          ((img.cx || 0) * (img.cy || 0)) > ((best.cx || 0) * (best.cy || 0)) ? img : best,
          contentImages[0]
        );
      }
      const blob = mediaFiles[main.path];
      if (blob) {
        const url = URL.createObjectURL(blob);
        state.objectURLs.push(url);
        inner.innerHTML = `<img class="thumb-image" src="${url}" alt="" loading="lazy">`;
      }
    }
    // Caso 3: só texto → mostra layout textual fiel
    else {
      const titleHtml = slide.title
        ? `<div class="thumb-title">${escapeHtml(slide.title)}</div>`
        : '';
      const bodyHtml = slide.paragraphs.length
        ? `<div class="thumb-body">${slide.paragraphs.slice(0, 4).map(p =>
            `<div class="thumb-line">${escapeHtml(p.slice(0, 80))}</div>`
          ).join('')}</div>`
        : '';
      if (titleHtml || bodyHtml) {
        inner.innerHTML = `<div class="thumb-text-layout">${titleHtml}${bodyHtml}</div>`;
      } else {
        inner.innerHTML = `<div class="thumb-empty">Slide vazio</div>`;
      }
    }

    wrap.appendChild(inner);
    return wrap;
  }

  // ─── Debug ─────────────────────────────────────────────────────────
  window.__pptxConverter = { state, log };
  log('info', 'Conversor carregado. Aguardando arquivo .pptx…');
})();
