/* ═══════════════════════════════════════════════════════════════════════
   PPTX-PARSER.JS · Parser OOXML para PPTX
   ─────────────────────────────────────────────────────────────────────
   STATUS: ESQUELETO (será implementado no passo 2 do MVP)

   Responsabilidades quando estiver pronto:
   - Para cada ppt/slides/slideN.xml:
       • Extrair textos (sp > txBody > p > r > t)
       • Listar referências de imagens (blip r:embed → _rels)
       • Detectar embeds de vídeo do YouTube (videoFile / hyperlinks)
       • Capturar speaker notes (ppt/notesSlides/notesSlideN.xml)
   - Resolver caminhos via _rels (slideN.xml.rels)
   - Retornar uma estrutura serializável:

     {
       title: string,
       slideCount: number,
       slides: [
         {
           index: 1,
           title: string | null,
           texts: string[],
           images: [{ id, path, width?, height? }],
           youtubeVideos: [{ url, videoId }],
           notes: string | null
         },
         …
       ],
       mediaFiles: { 'ppt/media/image1.png': Blob, … }
     }

   ENTRADA: instância JSZip (já carregada com o .pptx)
   SAÍDA:   Promise<ParsedDeck>
   ═══════════════════════════════════════════════════════════════════════ */

window.PPTXParser = {
  /**
   * Parseia o PPTX e retorna a estrutura intermediária.
   * @param {JSZip} zip
   * @param {(level:string,msg:string)=>void} [logger]
   * @returns {Promise<object>}
   */
  async parse(zip, logger) {
    const log = logger || (() => {});
    log('warn', 'PPTXParser.parse() ainda não implementado (passo 2).');
    // TODO: passo 2 — implementar extração real
    return {
      title: null,
      slideCount: 0,
      slides: [],
      mediaFiles: {},
    };
  },
};
