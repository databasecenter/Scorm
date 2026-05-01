/* ═══════════════════════════════════════════════════════════════════════
   SCORM-GENERATOR.JS · Gerador de pacote SCORM 2004 4th Edition
   ─────────────────────────────────────────────────────────────────────
   STATUS: ESQUELETO (será implementado no passo 3 do MVP)

   Responsabilidades quando estiver pronto:
   - Receber a estrutura ParsedDeck do PPTXParser
   - Gerar imsmanifest.xml válido SCORM 2004 4ed
   - Copiar arquivos de mídia pro pacote (ex: media/image1.png)
   - Renderizar slides como HTMLs estáticos (ou JSON consumido por player.html)
   - Incluir player.html + player.js + player.css com API_1484_11
   - Empacotar tudo num .zip via JSZip
   - Retornar Blob pra download

   COMPATIBILIDADE-ALVO:
   - Plataforma TONOFF (https://databasecenter.github.io/tonoff/)
     • Detecta launchURL pelo <resource href="..."> do manifest
     • Implementa window.API_1484_11 com Initialize/SetValue/Terminate
   - SCORM Cloud, Moodle, Blackboard

   REQUISITOS CRÍTICOS (lições aprendidas com iSpring):
   ✓ Vídeos YouTube via iframe SIMPLES /embed/{id} — SEM enablejsapi
   ✓ Tudo via HTTPS — sem Mixed Content
   ✓ Estrutura plana — index.html na raiz
   ✓ Reportar progresso real via cmi.completion_status + cmi.progress_measure

   ENTRADA: ParsedDeck (de PPTXParser)
   SAÍDA:   Promise<Blob>  (ZIP pronto pra download)
   ═══════════════════════════════════════════════════════════════════════ */

window.SCORMGenerator = {
  /**
   * Gera o pacote SCORM e devolve um Blob.
   * @param {object} parsedDeck
   * @param {object} [opts] - { title, identifier, language }
   * @param {(level:string,msg:string)=>void} [logger]
   * @returns {Promise<Blob>}
   */
  async generate(parsedDeck, opts, logger) {
    const log = logger || (() => {});
    log('warn', 'SCORMGenerator.generate() ainda não implementado (passo 3).');
    // TODO: passo 3 — implementar geração real
    return new Blob([], { type: 'application/zip' });
  },
};
