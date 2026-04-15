const { addonBuilder, serveHTTP, publishToCentral } = require("stremio-addon-sdk");

// ==========================================
// CONFIGURAÇÃO
// ==========================================
const PORT = process.env.PORT || 7000;
const ADDON_ID = "com.ecranfilmes.fembed-sniffer";
const ADDON_VERSION = "1.0.0";
const ADDON_NAME = "Ecran Filmes - Fembed Sniffer";

// ==========================================
// MANIFEST
// ==========================================
const manifest = {
  id: ADDON_ID,
  version: ADDON_VERSION,
  name: ADDON_NAME,
  description: "Extrai streams do Fembed.sx usando sniffer local no Ecran Filmes",
  logo: "https://i.imgur.com/ecranfilmes.png",
  
  // Recursos que o addon fornece
  resources: ["stream"],
  
  // Tipos de conteúdo suportados
  types: ["movie", "series"],
  
  // Catálogos (vazio porque só fornecemos streams)
  catalogs: [],
  
  // Prefixos de ID que aceitamos (tmdb)
  idPrefixes: ["tmdb:"],
  
  // Comportamento
  behaviorHints: {
    adult: false,
    p2p: false,
    configurable: false
  }
};

// ==========================================
// BUILDER
// ==========================================
const builder = new addonBuilder(manifest);

// ==========================================
// STREAM HANDLER
// ==========================================
builder.defineStreamHandler(async (args) => {
  const { type, id } = args;
  
  console.log(`[${new Date().toISOString()}] Requisição: type=${type}, id=${id}`);
  
  try {
    // Extrai TMDB ID (remove prefixo "tmdb:")
    const cleanId = id.replace("tmdb:", "");
    
    // Extrai season/episode se for série
    // Formato: tmdb:12345:1:3 (season 1, episode 3)
    let tmdbId = cleanId;
    let season = 1;
    let episode = 1;
    
    if (type === "series") {
      const parts = cleanId.split(":");
      tmdbId = parts[0];
      if (parts.length >= 3) {
        season = parseInt(parts[1]) || 1;
        episode = parseInt(parts[2]) || 1;
      }
    }
    
    // Gera URL do embed baseado no tipo
    let embedUrl;
    let title;
    
    if (type === "series") {
      // Séries: https://fembed.sx/e/{tmdbId}-dub/{season}-{episode}
      embedUrl = `https://fembed.sx/e/${tmdbId}-dub/${season}-${episode}`;
      title = `S${season.toString().padStart(2, "0")}E${episode.toString().padStart(2, "0")} - Fembed Dublado`;
    } else {
      // Filmes: https://fembed.sx/e/{tmdbId}-dub
      embedUrl = `https://fembed.sx/e/${tmdbId}-dub`;
      title = "Fembed - Dublado";
    }
    
    console.log(`[${new Date().toISOString()}] Embed URL: ${embedUrl}`);
    
    // Retorna stream com metadados para seu app Flutter
    const stream = {
      // URL que será passada para o EmbedPlayer
      url: embedUrl,
      
      // Título exibido no Stremio
      title: title,
      
      // Descrição
      description: "🔗 Clique para abrir no Ecran Filmes",
      
      // Metadados extras
      behaviorHints: {
        // Indica que precisa de sniffer (não é stream direto)
        notWebReady: true,
        
        // Headers necessários para o sniffer
        proxyHeaders: {
          request: {
            "Referer": "https://fembed.sx/",
            "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36",
            "Accept": "*/*",
            "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
          }
        },
        
        // Indica que deve abrir externamente
        external: true
      }
    };
    
    return { streams: [stream] };
    
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Erro:`, error);
    return { streams: [] };
  }
});

// ==========================================
// INICIA SERVIDOR
// ==========================================
const addonInterface = builder.getInterface();

serveHTTP(addonInterface, { port: PORT })
  .then(() => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║           🎬 Ecran Filmes - Stremio Addon                  ║
╠════════════════════════════════════════════════════════════╣
║  Addon rodando na porta: ${PORT}                            ║
║                                                            ║
║  Manifest:  http://localhost:${PORT}/manifest.json          ║
║                                                            ║
║  Para instalar no Stremio:                                 ║
║  stremio://install?url=http://localhost:${PORT}/manifest.json
╚════════════════════════════════════════════════════════════╝
    `);
    
    // Publica no diretório central (opcional - descomente se quiser)
    // publishToCentral(`http://localhost:${PORT}/manifest.json`);
  })
  .catch(err => {
    console.error("Erro ao iniciar servidor:", err);
    process.exit(1);
  });
