import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { config } from './config.js';
import { resolveYouTubeMedia, extractYouTubeId } from './services/youtube.js';
import { resolveTikTokMedia, isTikTokUrl } from './services/tiktok.js';
import { resolveInstagramMedia, isInstagramUrl } from './services/instagram.js';
import { resolveWithYtDlp, checkYtDlpAvailable } from './services/ytdlp.js';
import { handleStreamProxy } from './services/proxy.js';
import { MediaResolutionResult } from './types/index.js';

const server = Fastify({
  logger: {
    level: config.environment === 'production' ? 'info' : 'debug',
  },
});

// Register plugins
await server.register(cors, {
  origin: config.corsOrigin,
  methods: ['GET', 'POST', 'OPTIONS'],
});
await server.register(sensible);

// Helper to determine base URL
function getBaseUrl(req: any): string {
  const forwardedProto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${config.port}`;
  return `${forwardedProto}://${host}`;
}

// 1. Healthcheck for Railway & monitoring
server.get('/health', async () => {
  const hasYtDlp = await checkYtDlpAvailable();
  return {
    status: 'ok',
    service: 'zyntra-server',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    engines: {
      innertube: 'active',
      ytdlp: hasYtDlp ? 'available' : 'unavailable',
    },
  };
});

server.get('/debug', async (req: any) => {
  const videoId = req.query?.id || 'tHLoP7luagw';
  const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip',
    },
    body: JSON.stringify({
      context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, osName: 'Android', osVersion: '11' } },
      videoId,
    }),
  });
  const data: any = await res.json();
  return {
    status: res.status,
    playability: data.playabilityStatus,
    formatsCount: data.streamingData?.formats?.length,
    adaptiveCount: data.streamingData?.adaptiveFormats?.length,
    firstFormatUrl: data.streamingData?.formats?.[0]?.url?.substring(0, 50),
  };
});

// 2. Resolve / Extract endpoint (POST & GET)
const handleResolve = async (req: any, reply: any) => {
  const url = (req.body?.url || req.query?.url) as string;

  if (!url || typeof url !== 'string') {
    return reply.status(400).send({ error: 'Missing "url" parameter' });
  }

  const hostBaseUrl = getBaseUrl(req);
  let result: MediaResolutionResult | null = null;
  let lastError: any = null;

  try {
    // 1. YouTube
    if (extractYouTubeId(url)) {
      server.log.info({ url }, 'Resolving via YouTube Innertube Engine');
      try {
        result = await resolveYouTubeMedia(url, hostBaseUrl);
      } catch (innertubeErr: any) {
        server.log.warn({ err: innertubeErr?.message }, 'Innertube resolution failed, falling back to yt-dlp');
        if (await checkYtDlpAvailable()) {
          result = await resolveWithYtDlp(url, hostBaseUrl);
        } else {
          throw innertubeErr;
        }
      }
    }
    // 2. TikTok
    else if (isTikTokUrl(url)) {
      server.log.info({ url }, 'Resolving via TikTok Engine');
      result = await resolveTikTokMedia(url, hostBaseUrl);
    }
    // 3. Instagram
    else if (isInstagramUrl(url)) {
      server.log.info({ url }, 'Resolving via Instagram Engine');
      result = await resolveInstagramMedia(url, hostBaseUrl);
    }
    // 4. yt-dlp fallback (Facebook, Twitter/X, Reddit, etc.)
    else if (await checkYtDlpAvailable()) {
      server.log.info({ url }, 'Resolving via yt-dlp Engine');
      result = await resolveWithYtDlp(url, hostBaseUrl);
    } else {
      throw new Error('Unsupported platform and no yt-dlp binary available');
    }

    return reply.send({
      success: true,
      data: result,
    });
  } catch (err: any) {
    server.log.error({ err, url }, 'Resolution failed');
    return reply.status(500).send({
      success: false,
      error: err.message || 'Failed to extract media',
    });
  }
};

server.post('/api/resolve', handleResolve);
server.get('/api/resolve', handleResolve);
server.post('/api/extract', handleResolve);
server.get('/api/extract', handleResolve);

// 3. Stream proxy endpoint (Guaranteed playback & Range support)
server.get('/api/stream', async (req, reply) => {
  const query = req.query as Record<string, string>;
  const targetUrl = query.url;
  const userAgent = query.ua;
  const referer = query.referer;
  const filename = query.filename;

  return handleStreamProxy(req, reply, {
    url: targetUrl,
    userAgent,
    referer,
    filename,
    asAttachment: false,
  });
});

// 4. Download proxy endpoint (Forces Content-Disposition: attachment)
server.get('/api/download', async (req, reply) => {
  const query = req.query as Record<string, string>;
  const targetUrl = query.url;
  const userAgent = query.ua;
  const referer = query.referer;
  const filename = query.filename;

  return handleStreamProxy(req, reply, {
    url: targetUrl,
    userAgent,
    referer,
    filename,
    asAttachment: true,
  });
});

// Start the server
const start = async () => {
  try {
    await server.listen({
      port: config.port,
      host: config.host,
    });
    console.log(`🚀 Zyntra Server running on http://${config.host}:${config.port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
