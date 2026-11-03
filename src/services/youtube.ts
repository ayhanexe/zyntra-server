import { Innertube } from 'youtubei.js';
import { FormatOption, AudioOption, MediaResolutionResult } from '../types/index.js';

interface InnertubeClient {
  name: string;
  id: number;
  version: string;
  userAgent: string;
  context: Record<string, any>;
}

let cachedVisitorData: string | null = null;
let lastVisitorDataTime = 0;

async function getVisitorData(): Promise<string | undefined> {
  if (cachedVisitorData && Date.now() - lastVisitorDataTime < 1800000) {
    return cachedVisitorData;
  }
  try {
    const yt = await Innertube.create();
    cachedVisitorData = yt.session.context.client.visitorData || null;
    lastVisitorDataTime = Date.now();
    return cachedVisitorData || undefined;
  } catch {
    return cachedVisitorData || undefined;
  }
}

const CLIENTS: InnertubeClient[] = [
  {
    name: 'ANDROID',
    id: 3,
    version: '20.10.38',
    userAgent: 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip',
    context: {
      client: {
        clientName: 'ANDROID',
        clientVersion: '20.10.38',
        androidSdkVersion: 30,
        osName: 'Android',
        osVersion: '11',
        hl: 'en',
        gl: 'US',
      },
    },
  },
  {
    name: 'ANDROID_VR',
    id: 28,
    version: '1.71.26',
    userAgent: 'com.google.android.apps.youtube.vr.oculus/1.71.26 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
    context: {
      client: {
        clientName: 'ANDROID_VR',
        clientVersion: '1.71.26',
        deviceMake: 'Oculus',
        deviceModel: 'Quest 3',
        androidSdkVersion: 32,
        osName: 'Android',
        osVersion: '12L',
        hl: 'en',
        gl: 'US',
      },
    },
  },
  {
    name: 'IOS',
    id: 5,
    version: '20.10.4',
    userAgent: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
    context: {
      client: {
        clientName: 'IOS',
        clientVersion: '20.10.4',
        deviceMake: 'Apple',
        deviceModel: 'iPhone16,2',
        osName: 'iPhone',
        osVersion: '18.3.2.22D82',
        hl: 'en',
        gl: 'US',
      },
    },
  },
];

const ENDPOINTS = [
  'https://youtubei.googleapis.com/youtubei/v1/player',
  'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
];

export function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\.|^m\.|^music\./, '');
    if (host === 'youtu.be') {
      return u.pathname.split('/')[1] || null;
    }
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts[0] === 'watch') return u.searchParams.get('v') || null;
      if (['shorts', 'live', 'embed', 'v', 'e'].includes(parts[0])) return parts[1] || null;
    }
  } catch {}
  // Check if raw 11-char ID was passed
  if (/^[A-Za-z0-9_-]{11}$/.test(url)) return url;
  return null;
}

export async function resolveYouTubeMedia(urlOrId: string, _hostBaseUrl?: string): Promise<MediaResolutionResult> {
  const videoId = extractYouTubeId(urlOrId);
  if (!videoId) {
    throw new Error('Invalid YouTube URL or Video ID');
  }

  let lastError: any = null;
  const attempts: string[] = [];
  const visitorData = await getVisitorData();

  for (const client of CLIENTS) {
    for (const endpoint of ENDPOINTS) {
      try {
        const reqHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          'User-Agent': client.userAgent,
          'X-YouTube-Client-Name': String(client.id),
          'X-YouTube-Client-Version': client.version,
        };

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: reqHeaders,
          body: JSON.stringify({
            context: {
              ...client.context,
              client: {
                ...client.context.client,
                ...(visitorData ? { visitorData } : {}),
              },
            },
            videoId,
            contentCheckOk: true,
            racyCheckOk: true,
          }),
        });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        attempts.push(`${client.name}: HTTP ${res.status} (${text.slice(0, 80)})`);
        lastError = new Error(`YouTube API HTTP error: ${res.status}`);
        continue;
      }

      const json: any = await res.json();
      const status = json?.playabilityStatus?.status;
      if (status && status !== 'OK') {
        attempts.push(`${client.name}: playability=${status} (${json?.playabilityStatus?.reason || ''})`);
        lastError = new Error(json.playabilityStatus.reason || `Video unplayable: ${status}`);
        continue;
      }

      const sd = json.streamingData;
      if (!sd) {
        attempts.push(`${client.name}: no streamingData`);
        lastError = new Error('No streaming data found');
        continue;
      }

      const vd = json.videoDetails || {};
      const rawFormats = sd.formats || [];
      const rawAdaptive = sd.adaptiveFormats || [];

      // Filter raw formats having direct URLs
      const progressiveList = rawFormats.filter((f: any) => typeof f.url === 'string');
      const adaptiveList = rawAdaptive.filter((f: any) => typeof f.url === 'string');

      if (progressiveList.length === 0 && adaptiveList.length === 0) {
        attempts.push(`${client.name}: 0 direct URLs (formats=${rawFormats.length}, adaptive=${rawAdaptive.length})`);
        lastError = new Error('All formats lack direct stream URLs (cipher required)');
        continue;
      }

      // Extract Audio streams
      const audioStreams: AudioOption[] = [];
      const adaptiveAudios = adaptiveList.filter((f: any) => String(f.mimeType).startsWith('audio/'));
      for (const a of adaptiveAudios) {
        const isMp4Audio = String(a.mimeType).includes('mp4');
        const ext = isMp4Audio ? 'm4a' : 'webm';
        const bitrate = a.bitrate ? Math.round(a.bitrate / 1000) : undefined;
        const label = `${bitrate ? `${bitrate}kbps` : 'HD'} (${ext.toUpperCase()})`;

        audioStreams.push({
          formatId: String(a.itag),
          label,
          ext,
          bitrate,
          filesize: a.contentLength ? parseInt(a.contentLength, 10) : undefined,
          url: a.url,
          headers: {
            'User-Agent': client.userAgent,
          },
        });
      }

      // Best audio stream for pairing with video-only adaptive streams
      const bestM4aAudio = adaptiveAudios.find((a: any) => a.itag === 140) || adaptiveAudios[0];
      const bestWebmAudio = adaptiveAudios.find((a: any) => a.itag === 251) || adaptiveAudios[0];

      // Build Video formats
      const videoFormats: FormatOption[] = [];

      // 1. Progressive formats (Audio + Video combined)
      for (const p of progressiveList) {
        const height = p.height || (p.qualityLabel ? parseInt(p.qualityLabel, 10) : 360);
        const ext = String(p.mimeType).includes('webm') ? 'webm' : 'mp4';

        videoFormats.push({
          formatId: String(p.itag),
          label: `${p.qualityLabel || `${height}p`} (Progressive)`,
          resolution: p.width && p.height ? `${p.width}x${p.height}` : undefined,
          width: p.width,
          height,
          fps: p.fps,
          ext,
          filesize: p.contentLength ? parseInt(p.contentLength, 10) : undefined,
          isMuxed: true,
          videoUrl: p.url,
          headers: {
            'User-Agent': client.userAgent,
          },
        });
      }

      // 2. High-res adaptive formats (1080p, 1440p, 4K 2160p)
      const adaptiveVideos = adaptiveList.filter((f: any) => String(f.mimeType).startsWith('video/'));
      for (const v of adaptiveVideos) {
        const height = v.height || (v.qualityLabel ? parseInt(v.qualityLabel, 10) : 0);
        const isWebm = String(v.mimeType).includes('webm');
        const ext = isWebm ? 'webm' : 'mp4';
        const partnerAudio = isWebm ? bestWebmAudio : bestM4aAudio;

        const videoSize = v.contentLength ? parseInt(v.contentLength, 10) : 0;
        const audioSize = partnerAudio?.contentLength ? parseInt(partnerAudio.contentLength, 10) : 0;

        videoFormats.push({
          formatId: String(v.itag),
          label: `${v.qualityLabel || `${height}p`} ${ext.toUpperCase()}`,
          resolution: v.width && v.height ? `${v.width}x${v.height}` : undefined,
          width: v.width,
          height,
          fps: v.fps,
          ext,
          filesize: videoSize && audioSize ? videoSize + audioSize : videoSize || undefined,
          isMuxed: false,
          videoUrl: v.url,
          audioUrl: partnerAudio?.url,
          headers: {
            'User-Agent': client.userAgent,
          },
        });
      }

      // De-duplicate formats by height + ext (preferring progressive streams, then highest bitrate)
      const uniqueFormatsMap = new Map<string, FormatOption>();
      for (const f of videoFormats) {
        const key = `${f.height}_${f.fps || 30}_${f.ext}`;
        const existing = uniqueFormatsMap.get(key);
        if (!existing) {
          uniqueFormatsMap.set(key, f);
          continue;
        }
        // Progressive streams (isMuxed: true) must always take priority over adaptive streams,
        // because progressive streams have no PO-token cutoff and download reliably on clients.
        if (f.isMuxed && !existing.isMuxed) {
          uniqueFormatsMap.set(key, f);
          continue;
        }
        if (!f.isMuxed && existing.isMuxed) {
          continue;
        }
        if ((f.filesize || 0) > (existing.filesize || 0)) {
          uniqueFormatsMap.set(key, f);
        }
      }

      const sortedFormats = Array.from(uniqueFormatsMap.values()).sort((a, b) => (b.height || 0) - (a.height || 0));

      const thumbs = vd.thumbnail?.thumbnails || [];
      const bestThumbnail = thumbs.length ? thumbs[thumbs.length - 1].url : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      return {
        id: videoId,
        title: vd.title || 'YouTube Video',
        description: vd.shortDescription,
        duration: vd.lengthSeconds ? parseInt(vd.lengthSeconds, 10) : undefined,
        thumbnail: bestThumbnail,
        uploader: {
          name: vd.author || 'Unknown Artist',
          url: vd.channelId ? `https://www.youtube.com/channel/${vd.channelId}` : undefined,
        },
        platform: 'youtube',
        formats: sortedFormats,
        audioFormats: audioStreams,
        originalUrl: `https://www.youtube.com/watch?v=${videoId}`,
        extractedAt: Date.now(),
      };
      } catch (e: any) {
        attempts.push(`${client.name} exception: ${e?.message || 'unknown'}`);
        lastError = e;
      }
    }
  }

  throw new Error(`Failed to resolve YouTube video: ${attempts.join(' | ') || lastError?.message || 'Unknown error'}`);
}
