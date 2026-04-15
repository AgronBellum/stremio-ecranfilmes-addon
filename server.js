const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

// Configurações
const CACHE = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutos
const STREMIO_TIMEOUT = 9000; // 9 segundos (segurança para o Render)

const manifest = {
    id: "com.ecranfilmes.dublado",
    version: "3.1.0",
    name: "Ecran Filmes - Dublados ptBR",
    description: "Filmes e séries dublados via Fembed Sniffer",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["imdb:", "tmdb:"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

async function sniffM3U8(embedUrl) {
    // 1. Verificar Cache
    const cached = CACHE.get(embedUrl);
    if (cached && (Date.now() - cached.time) < CACHE_TTL) return cached.url;

    let browser = null;
    try {
        browser = await puppeteer.launch({
            args: [
                ...chromium.args,
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--disable-gpu",
                "--no-zygote",
                "--single-process"
            ],
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Mobile Safari/537.36');

        // BLOQUEAR LIXO (Economiza RAM no Render)
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const type = req.resourceType();
            if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        let foundUrl = null;
        // Monitorar requisições de rede para pegar o .m3u8
        page.on('request', req => {
            const url = req.url();
            if (url.includes('.m3u8') || url.includes('google-proxy') || url.includes('r66nv9ed.com')) {
                foundUrl = url;
            }
        });

        // Tentar carregar a página rápido
        await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 7000 });

        // Se não achou de primeira, tenta um clique bobo no centro
        if (!foundUrl) {
            await page.mouse.click(100, 100);
            await new Promise(r => setTimeout(r, 1500));
        }

        if (foundUrl) {
            CACHE.set(embedUrl, { url: foundUrl, time: Date.now() });
        }

        return foundUrl;
    } catch (e) {
        console.error("Erro Sniff:", e.message);
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

builder.defineStreamHandler(async (args) => {
    const { type, id } = args;
    const cleanId = id.split(":")[0];
    const season = id.split(":")[1] || 1;
    const episode = id.split(":")[2] || 1;

    const embedUrl = type === "series" 
        ? `https://fembed.sx/e/${cleanId}-dub/${season}-${episode}`
        : `https://fembed.sx/e/${cleanId}-dub`;

    // Race condition: Ou o sniffer entrega em 9s, ou retornamos o link externo
    // Isso evita que o Stremio mostre "Erro de carregamento"
    const m3u8Url = await Promise.race([
        sniffM3U8(embedUrl),
        new Promise(resolve => setTimeout(() => resolve(null), STREMIO_TIMEOUT))
    ]);

    const streams = [];

    if (m3u8Url) {
        streams.push({
            url: m3u8Url,
            title: "Fembed HD 🎯",
            description: "✅ Encontrado via Sniffer",
            behaviorHints: {
                proxyHeaders: {
                    request: {
                        "Referer": "https://fembed.sx/",
                        "User-Agent": "Mozilla/5.0 (Linux; Android 13)"
                    }
                }
            }
        });
    }

    // Sempre adiciona o link externo como fallback seguro
    streams.push({
        externalUrl: embedUrl,
        title: "Abrir no Navegador/App 📱",
        description: "🔗 Caso o player direto falhe"
    });

    return { streams };
});

const port = process.env.PORT || 10000;
serveHTTP(builder.getInterface(), { port });
