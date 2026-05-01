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
    log('warn', 'Geração SCORM ainda não implementada (passo 3 do MVP).');
    log('info', 'No próximo passo: imsmanifest.xml + player + .zip baixável.');
  });

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

    // Cards
    slidesGrid.innerHTML = '';
    parsed.slides.forEach((slide) => {
      slidesGrid.appendChild(buildSlideCard(slide, parsed.mediaFiles));
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

  function buildSlideCard(slide, mediaFiles) {
    const card = document.createElement('article');
    card.className = 'slide-card' + (slide.error ? ' is-error' : '');

    // Header com número e flags
    const flags = [];
    if (slide.images.length) flags.push(`<span class="flag is-img">${slide.images.length} IMG</span>`);
    if (slide.youtubeVideos.length) flags.push(`<span class="flag is-yt">▶ ${slide.youtubeVideos.length} YT</span>`);
    if (slide.notes) flags.push(`<span class="flag is-notes">📝</span>`);

    const indexNum = String(slide.index).padStart(2, '0');
    card.innerHTML = `
      <header class="slide-card-header">
        <span><span class="slide-card-num">SLIDE ${indexNum}</span></span>
        <span class="slide-card-flags">${flags.join('')}</span>
      </header>
    `;

    // Thumbnails (se tiver imagens)
    if (slide.images.length > 0) {
      const thumbs = document.createElement('div');
      thumbs.className = 'slide-card-thumbs';
      slide.images.forEach((img) => {
        const blob = mediaFiles[img.path];
        const thumb = document.createElement('div');
        thumb.className = 'slide-thumb';
        if (blob) {
          const url = URL.createObjectURL(blob);
          state.objectURLs.push(url);
          thumb.style.backgroundImage = `url("${url}")`;
        }
        thumb.title = img.path;
        thumbs.appendChild(thumb);
      });
      card.appendChild(thumbs);
    }

    // Body
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

    // Vídeos YouTube
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
          `<span>${yt.videoId} · ${yt.source}</span>`;
        list.appendChild(a);
      });
      body.appendChild(list);
    }

    // Notas
    if (slide.notes) {
      const n = document.createElement('div');
      n.className = 'slide-notes';
      n.textContent = slide.notes;
      body.appendChild(n);
    }

    card.appendChild(body);
    return card;
  }

  // ─── Debug ─────────────────────────────────────────────────────────
  window.__pptxConverter = { state, log };
  log('info', 'Conversor carregado. Aguardando arquivo .pptx…');
})();
