import { MediaResolutionResult, FormatOption, AudioOption } from '../types/index.js';

export function isTikTokUrl(url: string): boolean {
  return /(tiktok\.com)/i.test(url);
}

export async function resolveTikTokMedia(url: string, hostBaseUrl: string): Promise<MediaResolutionResult> {
  // Resolve redirects (for vm.tiktok.com or vt.tiktok.com)
  let targetUrl = url;
  try {
    const headRes = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    });
    targetUrl = headRes.url;
  } catch {}

  // Extract video ID from URL
  const idMatch = targetUrl.match(/video\/(\d+)/) || targetUrl.match(/item\/detail\/\?itemId=(\d+)/);
  const videoId = idMatch ? idMatch[1] : `tt_${Date.now()}`;

  // Query TikWM API (free, reliable, widely used for watermark-free TikTok media)
  const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(targetUrl)}`;
  const res = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  if (!res.ok) {
    throw new Error(`TikTok resolver failed: HTTP ${res.status}`);
  }

  const json: any = await res.json();
  if (json.code !== 0 || !json.data) {
    throw new Error(json.msg || 'Failed to extract TikTok video');
  }

  const data = json.data;
  const title = data.title || 'TikTok Video';
  const authorName = data.author?.nickname || data.author?.unique_id || 'TikTok Creator';

  const formats: FormatOption[] = [];

  // HD / No Watermark Video
  const videoUrl = data.hdplay || data.play;
  if (videoUrl) {
    const proxyParams = new URLSearchParams({
      url: videoUrl,
      filename: `${title.slice(0, 50)}.mp4`,
    });

    formats.push({
      formatId: 'hd',
      label: 'HD No Watermark (MP4)',
      ext: 'mp4',
      isMuxed: true,
      filesize: data.size,
      videoUrl,
      proxyUrl: `${hostBaseUrl}/api/stream?${proxyParams.toString()}`,
      headers: {
        Referer: 'https://www.tiktok.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
  }

  // Audio track
  const audioFormats: AudioOption[] = [];
  if (data.music) {
    const proxyParams = new URLSearchParams({
      url: data.music,
      filename: `${data.music_info?.title || 'audio'}.mp3`,
    });

    audioFormats.push({
      formatId: 'audio',
      label: data.music_info?.title || 'Original Audio (MP3)',
      ext: 'mp3',
      url: data.music,
      proxyUrl: `${hostBaseUrl}/api/stream?${proxyParams.toString()}`,
      headers: {
        Referer: 'https://www.tiktok.com/',
      },
    });
  }

  return {
    id: String(data.id || videoId),
    title,
    duration: data.duration,
    thumbnail: data.cover || data.origin_cover,
    uploader: {
      name: authorName,
      url: data.author?.unique_id ? `https://www.tiktok.com/@${data.author.unique_id}` : undefined,
      avatar: data.author?.avatar,
    },
    platform: 'tiktok',
    formats,
    audioFormats,
    originalUrl: targetUrl,
    extractedAt: Date.now(),
  };
}
