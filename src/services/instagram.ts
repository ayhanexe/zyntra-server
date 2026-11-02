import { MediaResolutionResult, FormatOption, AudioOption } from '../types/index.js';

export function isInstagramUrl(url: string): boolean {
  return /(instagram\.com|instagr\.am)/i.test(url);
}

export async function resolveInstagramMedia(url: string, hostBaseUrl: string): Promise<MediaResolutionResult> {
  // Extract shortcode
  const match = url.match(/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/);
  const shortcode = match ? match[1] : null;

  if (!shortcode) {
    throw new Error('Invalid Instagram Reel or Post URL');
  }

  // Use fast GraphQL / public embed fallback API
  const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
  const res = await fetch(embedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to access Instagram embed: HTTP ${res.status}`);
  }

  const html = await res.text();
  
  // Extract video URL from HTML
  const videoMatch = html.match(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/) || html.match(/"video_url":"([^"]+)"/);
  const rawVideoUrl = videoMatch ? videoMatch[1].replace(/\\u0026/g, '&') : null;

  // Extract poster thumbnail
  const thumbMatch = html.match(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/);
  const thumbnail = thumbMatch ? thumbMatch[1].replace(/\\u0026/g, '&') : '';

  // Extract caption
  const captionMatch = html.match(/class="Caption"[^>]*>([\s\S]*?)<\/div>/);
  const title = captionMatch ? captionMatch[1].replace(/<[^>]+>/g, '').trim().slice(0, 80) : `Instagram Reel (${shortcode})`;

  if (!rawVideoUrl) {
    throw new Error('Video stream URL could not be extracted from Instagram post (may be private or photo-only)');
  }

  const proxyParams = new URLSearchParams({
    url: rawVideoUrl,
    referer: 'https://www.instagram.com/',
    filename: `instagram_${shortcode}.mp4`,
  });

  const formats: FormatOption[] = [
    {
      formatId: 'original',
      label: 'Original Quality (MP4)',
      ext: 'mp4',
      isMuxed: true,
      videoUrl: rawVideoUrl,
      proxyUrl: `${hostBaseUrl}/api/stream?${proxyParams.toString()}`,
      headers: {
        Referer: 'https://www.instagram.com/',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X)',
      },
    },
  ];

  const mp3Params = new URLSearchParams({
    url: rawVideoUrl,
    referer: 'https://www.instagram.com/',
    filename: `${title}.mp3`,
    format: 'mp3',
  });

  const audioFormats: AudioOption[] = [
    {
      formatId: 'mp3',
      label: 'Audio MP3 (192kbps)',
      ext: 'mp3',
      bitrate: 192,
      url: `${hostBaseUrl}/api/mp3?${mp3Params.toString()}`,
      proxyUrl: `${hostBaseUrl}/api/mp3?${mp3Params.toString()}`,
      headers: {
        Referer: 'https://www.instagram.com/',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X)',
      },
    },
  ];

  return {
    id: shortcode,
    title,
    thumbnail,
    platform: 'instagram',
    formats,
    audioFormats,
    originalUrl: `https://www.instagram.com/p/${shortcode}/`,
    extractedAt: Date.now(),
  };
}
