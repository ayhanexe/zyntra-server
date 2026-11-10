import { MusicIdentificationResult } from '../types/index.js';
import { extractYouTubeId } from './youtube.js';
import { recognizeBytes } from 'shazamio-core';
import crypto from 'crypto';

interface IdentifyOptions {
  tiktokUrl?: string;
  audioUrl?: string;
  videoUrl?: string;
  rawTitle?: string;
  rawAuthor?: string;
}

const GENERIC_SOUND_REGEX = /^(original\s*sound|orijinal\s*s[eə]s|original\s*tone|sound\s*by|audio|ses|sesi)(\s*[-–—_:]\s*.*)?$/i;

export function isGenericSound(title?: string | null): boolean {
  if (!title || !title.trim()) return true;
  const clean = title.trim();
  return GENERIC_SOUND_REGEX.test(clean) || clean.toLowerCase() === 'original sound' || clean.toLowerCase() === 'orijinal səs';
}

export async function searchYouTubeVideoId(query: string): Promise<{ videoId?: string; title?: string }> {
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return {};
    const html = await res.text();
    const match = html.match(/"videoId":"([A-Za-z0-9_-]{11})"/);
    if (match && match[1]) {
      return { videoId: match[1] };
    }
  } catch {
    // Search failed
  }
  return {};
}

/**
 * Recognizes audio directly using Shazam's acoustic fingerprinting engine (shazamio-core).
 * Works regardless of what custom/altered text the creator wrote as the sound title.
 */
async function recognizeAudioFromUrl(audioUrl: string): Promise<{ title: string; artist: string; youtubeUrl?: string; youtubeId?: string } | null> {
  try {
    const audioRes = await fetch(audioUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!audioRes.ok) {
      return null;
    }

    const arrayBuffer = await audioRes.arrayBuffer();
    const songBytes = new Uint8Array(arrayBuffer);
    if (songBytes.length < 2048) {
      return null;
    }

    const signatures = recognizeBytes(songBytes);
    if (!signatures || signatures.length === 0) {
      return null;
    }

    const sig = signatures[0];
    const uuid1 = crypto.randomUUID();
    const uuid2 = crypto.randomUUID();
    const shazamUrl = `https://amp.shazam.com/discovery/v5/en/US/android/-/tag/${uuid1}/${uuid2}`;

    const payload = {
      geolocation: { latitude: 0.0, longitude: 0.0 },
      signature: {
        uri: sig.uri,
        samplems: sig.samplems,
      },
      timestamp: Date.now(),
      timezone: 'UTC',
    };

    sig.free();

    const shazamRes = await fetch(shazamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 11; Pixel 4 Build/RQ3A.210905.001)',
        'X-Shazam-Platform': 'Android',
        'X-Shazam-App-Version': '14.15.0-210601',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      body: JSON.stringify(payload),
    });

    if (shazamRes.ok) {
      const json: any = await shazamRes.json();
      if (json.track && json.track.title) {
        const title = json.track.title.trim();
        const artist = (json.track.subtitle || '').trim();
        return {
          title,
          artist,
        };
      }
    }
  } catch (e: any) {
    // Shazam fingerprinting failed or network error
  }
  return null;
}

/**
 * Main music identification pipeline
 */
export async function identifyMusic(opts: IdentifyOptions, _hostBaseUrl: string): Promise<MusicIdentificationResult> {
  let title = opts.rawTitle?.trim() || '';
  let artist = opts.rawAuthor?.trim() || '';
  let audioStreamUrl = opts.audioUrl;
  let targetTikTokUrl = opts.tiktokUrl;
  let matchedCommercialSong: { title: string; author: string } | null = null;

  // 1. If TikTok URL is provided, fetch its media & music_info first
  if (targetTikTokUrl && /(tiktok\.com)/i.test(targetTikTokUrl)) {
    try {
      const tikwmUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(targetTikTokUrl)}&hd=1`;
      const res = await fetch(tikwmUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });
      if (res.ok) {
        const json: any = await res.json();
        if (json.code === 0 && json.data) {
          const d = json.data;
          audioStreamUrl = audioStreamUrl || d.music || d.music_info?.play;

          if (d.music_info?.matched_song?.title) {
            matchedCommercialSong = {
              title: d.music_info.matched_song.title,
              author: d.music_info.matched_song.author || artist,
            };
          }

          // If TikTok metadata is an official non-original catalog track
          if (d.music_info && d.music_info.original === false && d.music_info.title) {
            title = d.music_info.title;
            artist = d.music_info.author || artist;
          }
        }
      }
    } catch {
      // TikWM fetch failed
    }
  }

  // 2. High Priority: Audio Fingerprinting via Shazam
  // Because creators often name sounds arbitrary text ("kesfiyyat", "sped up", "trend", etc.),
  // the acoustic signature is the only 100% reliable source of truth.
  if (audioStreamUrl) {
    const shazamResult = await recognizeAudioFromUrl(audioStreamUrl);
    if (shazamResult && shazamResult.title) {
      const query = shazamResult.artist
        ? `${shazamResult.artist} - ${shazamResult.title}`
        : shazamResult.title;
      const { videoId } = await searchYouTubeVideoId(query);

      return {
        recognized: true,
        title: shazamResult.title,
        artist: shazamResult.artist,
        cleanQuery: query,
        youtubeUrl: videoId
          ? `https://www.youtube.com/watch?v=${videoId}`
          : `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
        youtubeVideoId: videoId,
        audioUrl: audioStreamUrl,
        method: 'audio_fingerprint',
      };
    }
  }

  // 3. TikTok Internal Matched Song (from TikTok copyright database)
  if (matchedCommercialSong) {
    const query = `${matchedCommercialSong.author} - ${matchedCommercialSong.title}`.trim();
    const { videoId } = await searchYouTubeVideoId(query);
    return {
      recognized: true,
      title: matchedCommercialSong.title,
      artist: matchedCommercialSong.author,
      cleanQuery: query,
      youtubeUrl: videoId
        ? `https://www.youtube.com/watch?v=${videoId}`
        : `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
      youtubeVideoId: videoId,
      audioUrl: audioStreamUrl,
      method: 'matched_song',
    };
  }

  // 4. If title is an explicit, non-generic catalog title
  if (title && !isGenericSound(title)) {
    const query = artist && !title.toLowerCase().includes(artist.toLowerCase())
      ? `${artist} - ${title}`
      : title;
    const { videoId } = await searchYouTubeVideoId(query);
    return {
      recognized: true,
      title,
      artist,
      cleanQuery: query,
      youtubeUrl: videoId
        ? `https://www.youtube.com/watch?v=${videoId}`
        : `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
      youtubeVideoId: videoId,
      audioUrl: audioStreamUrl,
      method: 'metadata',
    };
  }

  // 5. Safe Fallback: NEVER send creator sentences or captions to YouTube
  const safeQuery = artist ? `${artist} Sound` : 'TikTok Sound';
  return {
    recognized: false,
    title: 'Orijinal Səs (TikTok)',
    artist: artist || 'TikTok Müəllifi',
    cleanQuery: safeQuery,
    youtubeUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(safeQuery)}`,
    audioUrl: audioStreamUrl,
    method: 'fallback',
  };
}
