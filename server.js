const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

// ==========================================
// CONFIG
// ==========================================
const CACHE = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutos
const SNIFF_TIMEOUT = 20000; // 20 segundos

// ==========================================
// MANIFEST
// ==========================================
const manifest = {
  id: "com.ecranfilmes.dublado",
  version: "3.0.0",
  name: "Ecran Filmes - Dublados ptBR",
  description: "Filmes e séries dublados via Fembed",
  logo: "https://i.imgur.com/ecranfilmes.png",
  resources: ["stream"],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["imdb:", "tmdb:"],
  behaviorHints: { 
    adult: false, 
    p2p: false, 
    configurable: false 
  }
};

const builder = new addonBuilder(manifest);

// ==========================================
// SNIFFER OTIMIZADO PARA RENDER
// ==========================================
async function sniffM3U8(embedUrl) {
  console.log(`[SNIFF] Iniciando: ${embedUrl}`);
  
  // Check cache
  const cached = CACHE.get(embedUrl);
  if (cached && (Date.now() - cached.time) < CACHE_TTL) {
    console.log(`[SNIFF] Cache hit!`);
    return cached.url;
  }
  
  let browser = null;
  
  try {
    // Launch com @sparticuz/chromium (otimizado para serverless)
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true
    });
    
    const page = await browser.newPage();
    
    // User agent mobile
    await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');
    await page.setViewport({ width: 1280, height: 720 });
    
    let m3u8Found = null;
    
    // Intercepta requisições
    await page.setRequestInterception(true);
    
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('r66nv9ed.com') && url.includes('.m3u8')) {
        if (!m3u8Found) {
          m3u8Found = url;
          console.log(`[SNIFF] 🎯 ENCONTRADO: ${url.substring(0, 80)}...`);
        }
      }
      req.continue();
    });
    
    const startTime = Date.now();
    
    // Navega
    await page.goto(embedUrl, { 
      waitUntil: 'networkidle2', 
      timeout: 15000 
    });
    
    // Aguarda m3u8 ou timeout
    while (!m3u8Found && (Date.now() - startTime) < SNIFF_TIMEOUT) {
      await new Promise(r => setTimeout(r, 500));
      
      // Força play
      try {
        await page.evaluate(() => {
          const video = document.querySelector('video');
          if (video) {
            video.play().catch(() => {});
            video.muted = true;
          }
        });
        
        const playBtn = await page.$('.play-button, .vjs-big-play-button, [class*="play"], button');
        if (playBtn) await playBtn.click().catch(() => {});
      } catch (e) {}
    }
    
    await browser.close();
    
    if (m3u8Found) {
      CACHE.set(embedUrl, { url: m3u8Found, time: Date.now() });
      console.log(`[SNIFF] ✅ Sucesso!`);
      return m3u8Found;
    }
    
    console.log(`[SNIFF] ❌ Timeout`);
    return null;
    
  } catch (error) {
    console.error(`[SNIFF] Erro:`, error.message);
    if (browser) await browser.close().catch(() => {});
    return null;
  }
}

// ==========================================
// STREAM HANDLER
// ==========================================
builder.defineStreamHandler(async (args) => {
  const { type, id } = args;
  
  console.log(`[REQ] ${type}: ${id}`);
  
  try {
    // Parse ID
    let cleanId = id.replace(/^(imdb:|tmdb:)/, "");
    let contentId = cleanId;
    let season = 1;
    let episode = 1;
    
    if (type === "series") {
      const parts = cleanId.split(":");
      contentId = parts[0];
      if (parts.length >= 2) season = parseInt(parts[1]) || 1;
      if (parts.length >= 3) episode = parseInt(parts[2]) || 1;
    }
    
    // URL Fembed
    const embedUrl = type === "series" 
      ? `https://fembed.sx/e/${contentId}-dub/${season}-${episode}`
      : `https://fembed.sx/e/${contentId}-dub`;
    
    console.log(`[REQ] Embed: ${embedUrl}`);
    
    // 🔥 SNIFFA
    const m3u8Url = await sniffM3U8(embedUrl);
    
    if (m3u8Url) {
      return { 
        streams: [{
          url: m3u8Url,
          title: type === "series" 
            ? `S${season.toString().padStart(2, "0")}E${episode.toString().padStart(2, "0")} - Fembed HD 🎯`
            : "Fembed - Dublado HD 🎯",
          description: "✅ Stream direto",
          behaviorHints: {
            notWebReady: false,
            proxyHeaders: {
              request: {
                "Referer": "https://fembed.sx/",
                "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36",
                "Accept": "*/*"
              }
            }
          }
        }] 
      };
    }
    
    // Fallback
    const deepLink = `ecranfilmes://play?url=${encodeURIComponent(embedUrl)}&id=${contentId}&s=${season}&e=${episode}&type=${type}`;
    
    return { 
      streams: [{
        url: deepLink,
        title: type === "series" 
          ? `S${season.toString().padStart(2, "0")}E${episode.toString().padStart(2, "0")} - Abrir no App 📱`
          : "Abrir no Ecran Filmes 📱",
        description: "🔗 Requer app instalado",
        external: true,
        behaviorHints: { external: true, notWebReady: true }
      }] 
    };
    
  } catch (error) {
    console.error(`[REQ] Erro:`, error);
    return { streams: [] };
  }
});

// ==========================================
// START
// ==========================================
const port = process.env.PORT || 10000;
serveHTTP(builder.getInterface(), { port });
console.log(`🚀 Ecran Filmes addon rodando na porta ${port}`);
