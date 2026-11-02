import { spawn } from 'child_process';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'stream';

let ffmpegChecked: boolean | null = null;

export async function checkFfmpegAvailable(): Promise<boolean> {
  if (ffmpegChecked !== null) return ffmpegChecked;
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-version']);
    proc.on('error', () => {
      ffmpegChecked = false;
      resolve(false);
    });
    proc.on('close', (code) => {
      ffmpegChecked = code === 0;
      resolve(ffmpegChecked);
    });
  });
}

export interface Mp3ConversionOptions {
  url: string;
  userAgent?: string;
  referer?: string;
  filename?: string;
  bitrate?: string;
}

export async function handleMp3Conversion(
  req: FastifyRequest,
  reply: FastifyReply,
  options: Mp3ConversionOptions
) {
  const { url, userAgent, referer, filename, bitrate = '192k' } = options;

  if (!url || !/^https?:\/\//i.test(url)) {
    return reply.status(400).send({ error: 'Valid URL parameter is required' });
  }

  const hasFfmpeg = await checkFfmpegAvailable();
  if (!hasFfmpeg) {
    req.log.error('ffmpeg binary is not available on this server');
    return reply.status(500).send({
      error: 'ffmpeg binary is not available for MP3 transcoding on this server',
    });
  }

  const forwardHeaders: Record<string, string> = {
    'User-Agent': userAgent || (req.headers['user-agent'] as string) || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    Accept: '*/*',
    'Accept-Encoding': 'identity',
  };

  if (referer && !url.includes('googlevideo.com')) {
    forwardHeaders.Referer = referer;
  }

  try {
    const upstream = await fetch(url, {
      method: 'GET',
      headers: forwardHeaders,
    });

    if (!upstream.ok) {
      return reply.status(upstream.status).send({
        error: `Upstream error fetching audio: HTTP ${upstream.status} ${upstream.statusText}`,
      });
    }

    if (!upstream.body) {
      return reply.status(502).send({ error: 'No audio body received from upstream' });
    }

    const rawName = (filename || 'audio.mp3').trim();
    const cleanName = rawName.endsWith('.mp3') ? rawName : `${rawName}.mp3`;
    const safeFilename = cleanName.replace(/[^\w.-]/g, '_');

    reply.status(200);
    reply.header('Content-Type', 'audio/mpeg');
    reply.header('Content-Disposition', `attachment; filename="${safeFilename}"`);
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Headers', 'Range, Authorization, Content-Type');
    reply.header('Access-Control-Expose-Headers', 'Content-Length, Content-Disposition');

    // Spawn ffmpeg to transcode stdin to MP3 on stdout
    const validBitrate = /^\d{2,3}k?$/i.test(bitrate) ? (bitrate.endsWith('k') ? bitrate : `${bitrate}k`) : '192k';

    const ffmpeg = spawn('ffmpeg', [
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-vn',
      '-c:a', 'libmp3lame',
      '-b:a', validBitrate,
      '-f', 'mp3',
      'pipe:1',
    ]);

    const upstreamStream = Readable.fromWeb(upstream.body as any);
    upstreamStream.pipe(ffmpeg.stdin);

    upstreamStream.on('error', (err) => {
      req.log.warn({ err }, 'Upstream stream error during MP3 conversion');
      if (!ffmpeg.killed) ffmpeg.kill('SIGKILL');
    });

    ffmpeg.stdin.on('error', (err: any) => {
      req.log.debug({ err: err?.message }, 'ffmpeg stdin closed');
    });

    ffmpeg.stderr.on('data', (d) => {
      req.log.warn({ ffmpegErr: d.toString() }, 'ffmpeg stderr');
    });

    // Cleanup when client disconnects
    req.raw.on('close', () => {
      if (!ffmpeg.killed) {
        ffmpeg.kill('SIGKILL');
      }
    });

    return reply.send(ffmpeg.stdout);
  } catch (err: any) {
    req.log.error({ err }, 'MP3 conversion failed');
    return reply.status(502).send({
      error: `MP3 conversion failed: ${err.message}`,
    });
  }
}
