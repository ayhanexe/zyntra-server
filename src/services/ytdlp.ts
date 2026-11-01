import { spawn } from 'child_process';
import { MediaResolutionResult, FormatOption, AudioOption } from '../types/index.js';

let ytDlpChecked: boolean | null = null;

export async function checkYtDlpAvailable(): Promise<boolean> {
  if (ytDlpChecked !== null) return ytDlpChecked;
  return new Promise((resolve) => {
    const proc = spawn('yt-dlp', ['--version']);
    proc.on('error', () => {
      ytDlpChecked = false;
      resolve(false);
    });
    proc.on('close', (code) => {
      ytDlpChecked = code === 0;
      resolve(ytDlpChecked);
    });
  });
}

export async function resolveWithYtDlp(url: string, hostBaseUrl: string): Promise<MediaResolutionResult> {
  const isAvailable = await checkYtDlpAvailable();
  if (!isAvailable) {
    throw new Error('yt-dlp binary is not installed or available on this system');
  }

  return new Promise((resolve, reject) => {
    const args = [
      '--dump-single-json',
      '--no-warnings',
      '--no-playlist',
      '--format', 'bestvideo+bestaudio/best',
      '--extractor-args', 'youtube:player_client=android,ios;player_skip=webpage,configs',
      url,
    ];

    const proc = spawn('yt-dlp', args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => {
      stdout += d.toString();
    });

    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`yt-dlp failed with exit code ${code}: ${stderr || 'Unknown error'}`));
      }

      try {
        const json = JSON.parse(stdout);
        const title = json.title || 'Video';
        const formats: FormatOption[] = [];
        const audioFormats: AudioOption[] = [];

        for (const f of json.formats || []) {
          if (!f.url) continue;

          const isAudioOnly = f.vcodec === 'none' && f.acodec !== 'none';
          const isVideo = f.vcodec !== 'none';

          if (isAudioOnly) {
            const ext = f.ext || 'm4a';
            const proxyParams = new URLSearchParams({
              url: f.url,
              filename: `${title}.${ext}`,
            });

            audioFormats.push({
              formatId: String(f.format_id),
              label: `${f.abr ? `${Math.round(f.abr)}kbps` : 'Audio'} (${ext.toUpperCase()})`,
              ext,
              bitrate: f.abr,
              filesize: f.filesize || f.filesize_approx,
              url: f.url,
              proxyUrl: `${hostBaseUrl}/api/stream?${proxyParams.toString()}`,
              headers: f.http_headers,
            });
          } else if (isVideo) {
            const ext = f.ext || 'mp4';
            const height = f.height || 0;
            const proxyParams = new URLSearchParams({
              url: f.url,
              filename: `${title} [${height}p].${ext}`,
            });

            formats.push({
              formatId: String(f.format_id),
              label: `${f.format_note || `${height}p`} (${ext.toUpperCase()})`,
              resolution: f.resolution,
              width: f.width,
              height,
              fps: f.fps,
              ext,
              filesize: f.filesize || f.filesize_approx,
              isMuxed: f.acodec !== 'none',
              videoUrl: f.url,
              proxyUrl: `${hostBaseUrl}/api/stream?${proxyParams.toString()}`,
              headers: f.http_headers,
            });
          }
        }

        resolve({
          id: String(json.id || Date.now()),
          title,
          description: json.description,
          duration: json.duration,
          thumbnail: json.thumbnail,
          uploader: {
            name: json.uploader || json.channel || 'Creator',
            url: json.uploader_url,
          },
          platform: 'generic',
          formats: formats.sort((a, b) => (b.height || 0) - (a.height || 0)),
          audioFormats,
          originalUrl: url,
          extractedAt: Date.now(),
        });
      } catch (err: any) {
        reject(new Error(`Failed to parse yt-dlp output: ${err.message}`));
      }
    });
  });
}
