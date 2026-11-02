import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { config } from './config.js';
import { resolveYouTubeMedia, extractYouTubeId } from './services/youtube.js';
import { resolveTikTokMedia, isTikTokUrl } from './services/tiktok.js';
import { resolveInstagramMedia, isInstagramUrl } from './services/instagram.js';
import { resolveWithYtDlp, checkYtDlpAvailable } from './services/ytdlp.js';
import { checkFfmpegAvailable } from './services/mp3.js';
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
  const hasFfmpeg = await checkFfmpegAvailable();
  return {
    status: 'ok',
    service: 'zyntra-server',
    version: '1.1.0',
    timestamp: new Date().toISOString(),
    engines: {
      innertube: 'active',
      ytdlp: hasYtDlp ? 'available' : 'unavailable',
      ffmpeg: hasFfmpeg ? 'available' : 'unavailable',
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

server.get('/api/test-ytdlp', async (req: any) => {
  const videoId = req.query?.id || 'ufz85DcaIro';
  const { spawn } = await import('child_process');
  return new Promise((resolve) => {
    const proc = spawn('yt-dlp', [
      '--dump-single-json',
      '--no-warnings',
      '--no-playlist',
      `https://www.youtube.com/watch?v=${videoId}`,
    ]);
    let out = '';
    let err = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.stderr.on('data', d => err += d.toString());
    proc.on('close', code => {
      resolve({ code, err, outLen: out.length, title: (() => { try { return JSON.parse(out).title; } catch { return null; } })() });
    });
  });
});

server.get('/api/test-dl', async (req: any) => {
  const format = req.query?.format || '18';
  const videoId = req.query?.id || 'ufz85DcaIro';
  const { spawn } = await import('child_process');
  return new Promise((resolve) => {
    const proc = spawn('yt-dlp', [
      '-f', format,
      '-o', '-',
      `https://www.youtube.com/watch?v=${videoId}`,
    ]);
    let bytes = 0;
    let err = '';
    proc.stdout.on('data', d => {
      bytes += d.length;
      if (bytes > 500000) {
        proc.kill();
      }
    });
    proc.stderr.on('data', d => err += d.toString());
    proc.on('close', code => {
      resolve({ code, bytes, err });
    });
  });
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

// 3. Stream proxy endpoint (Deprecated - redirects or returns 410)
server.get('/api/stream', async (req: any, reply: any) => {
  const query = req.query as Record<string, string>;
  const targetUrl = query?.url;
  if (targetUrl) {
    return reply.redirect(targetUrl, 302);
  }
  return reply.status(410).send({
    error: 'Stream chunk proxying is disabled to prevent datacenter IP rate limits. Use direct stream URLs from /api/resolve.',
  });
});

// 4. Download proxy endpoint (Deprecated - redirects or returns 410)
server.get('/api/download', async (req: any, reply: any) => {
  const query = req.query as Record<string, string>;
  const targetUrl = query?.url;
  if (targetUrl) {
    return reply.redirect(targetUrl, 302);
  }
  return reply.status(410).send({
    error: 'Download proxying is disabled to prevent datacenter IP rate limits. Use direct stream URLs from /api/resolve.',
  });
});

// 5. Dedicated MP3 Conversion & Download endpoint (Deprecated - redirects or returns 410)
const handleMp3Route = async (req: any, reply: any) => {
  const query = req.query as Record<string, string>;
  const targetUrl = query?.url || req.body?.url;
  if (targetUrl) {
    return reply.redirect(targetUrl, 302);
  }
  return reply.status(410).send({
    error: 'Server-side MP3 transcode proxying is disabled. Use direct audio streams from /api/resolve.',
  });
};

server.get('/api/mp3', handleMp3Route);
server.post('/api/mp3', handleMp3Route);
server.get('/api/download/mp3', handleMp3Route);
server.post('/api/download/mp3', handleMp3Route);

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
