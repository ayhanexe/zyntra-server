# Zyntra Server 🚀

Yüksək performanslı, SnapTube arxitekturalı video/audio ekstraksiya və axın (streaming proxy) backend xidməti.

YouTube (4K, 1080p, 60fps, M4A/WebM), TikTok (Watermark-free HD), Instagram Reels/Post və digər platformaları (yt-dlp inteqrasiyası ilə) dəstəkləyir.

---

## 🌟 Əsas Xüsusiyyətlər

1. **Çox Müştərili YouTube Çıxarışı (Client Rotation):**
   - `ANDROID`, `IOS` və `TVHTML5_SIMPLY_EMBEDDED` klientlərini simulyasiya edərək Botguard/PO-Token bloklamalarından yayınır.
   - 4K (2160p), 2K (1440p), 1080p60, 720p və bütün audio formatları (`M4A`, `Opus`) təmiz şəkildə çıxarır.
   - Yüksək keyfiyyətli adaptiv video axınlarını uyğun ən yaxşı audio axını ilə avtomatik cütləşdirir.

2. **TikTok Su Nişansız (Watermark-Free) Yükləmə:**
   - TikTok videolarını su nişanı olmadan birbaşa HD MP4 və MP3 audio kimi çıxarır.

3. **Instagram Reels & Video Çıxarışı:**
   - Instagram videolarını və Reels paylaşımlarını birbaşa təmiz MP4 axınına çevirir.

4. **Stream & Download Proxy (`/api/stream` & `/api/download`):**
   - Bütün media axınlarını HTTP 206 (Partial Content / Range) ilə ötürür (videonu irəli-geri çəkmə və kəsilən yükləməni davam etdirmə dəstəyi).
   - Lazımi `User-Agent` və `Referer` başlıqlarını daxildə ötürərək 403 Forbidden xətalarını aradan qaldırır.
   - CORS qadağalarını ləğv edir.

5. **Railway & Docker Ready:**
   - Multi-stage Dockerfile (Node.js 22 + Python 3 + `yt-dlp` + `ffmpeg`).
   - `railway.json` konfiqurasiyası ilə tək kliklə avtomatik deploy.

---

## 📡 API Uç Nöqtələri (Endpoints)

### 1. `POST /api/resolve` və ya `GET /api/resolve?url=...`
İstənilən video/audio linkini analiz edib formatları qaytarır:

**Nümunə Sorğu:**
```json
POST /api/resolve
Content-Type: application/json

{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
}
```

**Nümunə Cavab:**
```json
{
  "success": true,
  "data": {
    "id": "dQw4w9WgXcQ",
    "title": "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)",
    "duration": 213,
    "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
    "platform": "youtube",
    "formats": [
      {
        "formatId": "313",
        "label": "2160p WEBM",
        "resolution": "3840x2160",
        "width": 3840,
        "height": 2160,
        "fps": 25,
        "ext": "webm",
        "filesize": 362042216,
        "isMuxed": false,
        "videoUrl": "https://...",
        "audioUrl": "https://...",
        "proxyUrl": "http://localhost:3000/api/stream?url=..."
      }
    ],
    "audioFormats": [
      {
        "formatId": "140",
        "label": "128kbps (M4A)",
        "ext": "m4a",
        "bitrate": 128,
        "filesize": 3433755,
        "url": "https://...",
        "proxyUrl": "http://localhost:3000/api/stream?url=..."
      }
    ]
  }
}
```

### 2. `GET /api/stream?url=...`
Videonun proksi vasitəsilə axınını (streaming) təmin edir. Range başlıqlarını tam dəstəkləyir.

### 3. `GET /api/download?url=...&filename=...`
Faylı birbaşa yüklənməsi üçün `Content-Disposition: attachment` başlığı ilə ötürür.

### 4. `GET /health`
Serverin vəziyyətini yoxlayır (Railway Healthcheck üçün).

---

## 🛠️ Lokal İşə Salma

```bash
# Asılılıqları quraşdırın
pnpm install

# Proyektı qurun
pnpm build

# Serveri başladın
pnpm start
# və ya inkişaf rejimində:
pnpm dev
```

---

## 🚂 Railway-ə Quraşdırma (Deployment)

1. Bu qovluğu (`zyntra-server`) GitHub reposuna push edin (və ya Railway CLI istifadə edin).
2. [Railway.app](https://railway.com)-da **New Project -> Deploy from GitHub repo** seçin.
3. Railway avtomatik olaraq daxildəki `Dockerfile` və `railway.json` faylını aşkarlayacaq və layihəni quraşdıracaq.
4. Server hazır olanda Railway sizə `https://zyntra-server-production.up.railway.app` kimi domen verəcək.
5. Həmin ünvanı Zyntra tətbiqinizdə əsas ekstraksiya serveri kimi təyin edə bilərsiniz!
