/* ═══════════════════════════════════════════════════════════════════════
   CONVERTER.JS · Orquestrador principal · PPTX → SCORM
   ─────────────────────────────────────────────────────────────────────
   Responsável por:
   - Capturar o arquivo (drag&drop ou input)
   - Validar que é um PPTX legítimo (ZIP + ppt/presentation.xml)
   - Coletar estatísticas iniciais (slides, mídias)
   - Atualizar a UI e o log
   - Disparar o pipeline: PPTXParser → SCORMGenerator (próximos passos)
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── Estado em memória (uma conversão por vez) ─────────────────────
  const state = {
    file: null,        // File original
    zip: null,         // JSZip instance do PPTX
    stats: null,       // { slideCount, imageCount, mediaCount }
    parsed: null,      // resultado do PPTXParser (passo 2)
  };

  // ─── DOM refs ──────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const dropzone   = $('dropzone');
  const fileInput  = $('fileInput');
  const panel      = $('panel');
  const panelStatus= $('panelStatus');
  const fileName   = $('fileName');
  const fileSize   = $('fileSize');
  const statSlides = $('statSlides');
  const statImages = $('statImages');
  const statMedia  = $('statMedia');
  const statSize   = $('statSize');
  const logBlock   = $('logBlock');
  const btnConvert = $('btnConvert');
  const btnReset   = $('btnReset');

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
    // Mirror no console pra facilitar debug
    const fn = level === 'err' ? 'error' : level === 'warn' ? 'warn' : 'log';
    console[fn](`[converter] ${msg}`);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  // ─── Helpers de UI ─────────────────────────────────────────────────
  function setStatus(text, mode /* 'is-busy' | 'is-error' | '' */) {
    panelStatus.textContent = text;
    panelStatus.classList.remove('is-busy', 'is-error');
    if (mode) panelStatus.classList.add(mode);
  }
  function showPanel() { panel.classList.add('is-visible'); }
  function hidePanel() { panel.classList.remove('is-visible'); }
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
    fileInput.value = '';
    statSlides.textContent = '—';
    statImages.textContent = '—';
    statMedia.textContent  = '—';
    statSize.textContent   = '—';
    logBlock.innerHTML = '';
    btnConvert.disabled = true;
    hidePanel();
  }

  // ─── Drag & drop ───────────────────────────────────────────────────
  ['dragenter', 'dragover'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('is-drag');
    });
  });
  ['dragleave', 'drop'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('is-drag');
    });
  });
  dropzone.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  // Input clássico
  fileInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) handleFile(f);
  });

  // Evita que o navegador abra o arquivo se o usuário soltar fora do dropzone
  ['dragover', 'drop'].forEach(evt => {
    window.addEventListener(evt, (e) => e.preventDefault(), false);
  });

  // Reset
  btnReset.addEventListener('click', () => {
    resetState();
    log('info', 'Estado resetado. Pronto para novo arquivo.');
  });

  // Botão de conversão (passo 3 — placeholder por enquanto)
  btnConvert.addEventListener('click', () => {
    if (!state.zip) return;
    log('warn', 'Geração SCORM ainda não implementada (passo 3 do MVP).');
    log('info', 'Próximo passo: extrair texto/imagens dos slides e gerar imsmanifest.xml.');
  });

  // ─── Pipeline principal ────────────────────────────────────────────
  async function handleFile(file) {
    resetState();
    state.file = file;

    // 1. Validações superficiais
    fileName.textContent = file.name;
    fileSize.textContent = fmtBytes(file.size);
    statSize.textContent = fmtBytes(file.size);
    showPanel();
    setStatus('ANALISANDO', 'is-busy');

    log('info', `Arquivo recebido: ${file.name} (${fmtBytes(file.size)})`);

    if (!file.name.toLowerCase().endsWith('.pptx')) {
      setStatus('ARQUIVO INVÁLIDO', 'is-error');
      log('err', 'Extensão não é .pptx. Operação abortada.');
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setStatus('ARQUIVO MUITO GRANDE', 'is-error');
      log('err', 'Arquivo excede o limite de 100 MB.');
      return;
    }
    if (typeof JSZip === 'undefined') {
      setStatus('LIB NÃO CARREGADA', 'is-error');
      log('err', 'JSZip não disponível. Verifique conexão / CDN.');
      return;
    }

    // 2. Tenta abrir como ZIP (PPTX é um ZIP)
    try {
      log('info', 'Lendo bytes do arquivo…');
      const buffer = await file.arrayBuffer();
      log('info', 'Decompactando estrutura interna do PPTX (OOXML)…');
      const zip = await JSZip.loadAsync(buffer);
      state.zip = zip;
      log('ok', `ZIP aberto. ${Object.keys(zip.files).length} entradas encontradas.`);
    } catch (err) {
      setStatus('ZIP CORROMPIDO', 'is-error');
      log('err', 'Não foi possível ler o arquivo como ZIP. Talvez esteja corrompido.');
      console.error(err);
      return;
    }

    // 3. Verifica que é mesmo um PPTX (precisa ter ppt/presentation.xml)
    if (!state.zip.file('ppt/presentation.xml')) {
      setStatus('NÃO É UM PPTX', 'is-error');
      log('err', 'Estrutura interna não corresponde a um arquivo PPTX (faltou ppt/presentation.xml).');
      log('warn', 'Talvez seja um .ppt (formato antigo) ou outro tipo de arquivo Office.');
      return;
    }
    log('ok', 'Estrutura PPTX validada (ppt/presentation.xml presente).');

    // 4. Coleta estatísticas rápidas (sem parsing OOXML pesado)
    try {
      const stats = quickScan(state.zip);
      state.stats = stats;
      statSlides.textContent = String(stats.slideCount);
      statImages.textContent = String(stats.imageCount);
      statMedia.textContent  = String(stats.mediaCount);

      log('ok', `Detectados ${stats.slideCount} slide(s).`);
      if (stats.imageCount) log('info', `Encontradas ${stats.imageCount} imagem(ns) embutidas.`);
      if (stats.mediaCount) log('info', `Encontradas ${stats.mediaCount} mídia(s) (vídeo/áudio).`);
      if (!stats.slideCount) {
        log('warn', 'Nenhum slide encontrado — apresentação parece estar vazia.');
      }
    } catch (err) {
      log('warn', 'Falha ao coletar estatísticas, mas o arquivo é válido.');
      console.error(err);
    }

    // 5. Pronto pro próximo passo
    setStatus('PRONTO PARA CONVERSÃO');
    btnConvert.disabled = false;
    log('ok', 'Análise concluída. Pronto para gerar pacote SCORM.');
    log('info', '→ Próximo passo (em desenvolvimento): extrair conteúdo dos slides.');
  }

  // ─── Scan rápido do ZIP (não faz parsing OOXML profundo) ──────────
  // Apenas conta entradas em pastas conhecidas — feedback instantâneo.
  function quickScan(zip) {
    let slideCount = 0;
    let imageCount = 0;
    let mediaCount = 0;

    Object.keys(zip.files).forEach((path) => {
      // Slides reais ficam em ppt/slides/slide1.xml, slide2.xml, …
      // (NÃO contamos slideLayout/slideMaster nem _rels/)
      if (/^ppt\/slides\/slide\d+\.xml$/i.test(path)) {
        slideCount++;
      }
      // Mídia embutida: ppt/media/image1.png, video1.mp4, audio1.m4a, etc.
      if (/^ppt\/media\//i.test(path) && !path.endsWith('/')) {
        const ext = path.split('.').pop().toLowerCase();
        if (['png','jpg','jpeg','gif','bmp','tiff','svg','emf','wmf'].includes(ext)) {
          imageCount++;
        } else if (['mp4','m4v','mov','avi','wmv','mp3','m4a','wav','ogg'].includes(ext)) {
          mediaCount++;
        }
      }
    });

    return { slideCount, imageCount, mediaCount };
  }

  // ─── Exposição global pra debug no console ─────────────────────────
  window.__pptxConverter = { state, log };
  log('info', 'Conversor carregado. Aguardando arquivo .pptx…');
})();
