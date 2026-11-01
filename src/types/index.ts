export type Platform = 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'generic';

export interface MediaUploader {
  name: string;
  url?: string;
  avatar?: string;
}

export interface FormatOption {
  formatId: string;
  label: string;
  resolution?: string;
  width?: number;
  height?: number;
  fps?: number;
  ext: string;
  filesize?: number;
  isMuxed: boolean;
  videoUrl: string;
  audioUrl?: string;
  proxyUrl: string;
  headers?: Record<string, string>;
}

export interface AudioOption {
  formatId: string;
  label: string;
  ext: string;
  bitrate?: number;
  filesize?: number;
  url: string;
  proxyUrl: string;
  headers?: Record<string, string>;
}

export interface MediaResolutionResult {
  id: string;
  title: string;
  description?: string;
  duration?: number;
  thumbnail: string;
  uploader?: MediaUploader;
  platform: Platform;
  formats: FormatOption[];
  audioFormats: AudioOption[];
  originalUrl: string;
  extractedAt: number;
}
