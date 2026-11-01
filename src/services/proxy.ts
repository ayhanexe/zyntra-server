import { FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'stream';

export interface StreamProxyOptions {
  url: string;
  userAgent?: string;
  referer?: string;
  filename?: string;
  asAttachment?: boolean;
}

export async function handleStreamProxy(
  req: FastifyRequest,
  reply: FastifyReply,
  options: StreamProxyOptions
) {
  const { url, userAgent, referer, filename, asAttachment } = options;

  if (!url || !/^https?:\/\//i.test(url)) {
    return reply.status(400).send({ error: 'Valid URL parameter is required' });
  }

  const forwardHeaders: Record<string, string> = {
    'User-Agent': userAgent || (req.headers['user-agent'] as string) || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    Accept: '*/*',
    'Accept-Encoding': 'identity', // Ensure no unwanted compression on raw media
  };

  if (referer) {
    forwardHeaders.Referer = referer;
  }

  // Forward client Range request header if present (crucial for resume & seeking)
  const clientRange = req.headers.range;
  if (clientRange) {
    forwardHeaders.Range = clientRange;
  }

  try {
    const upstream = await fetch(url, {
      method: 'GET',
      headers: forwardHeaders,
    });

    if (!upstream.ok && upstream.status !== 206) {
      return reply.status(upstream.status).send({
        error: `Upstream error: HTTP ${upstream.status} ${upstream.statusText}`,
      });
    }

    // Set response status (206 if partial, 200 if full)
    reply.status(upstream.status);

    // Forward relevant media headers
    const copyHeaders = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'last-modified',
      'etag',
    ];

    for (const h of copyHeaders) {
      const val = upstream.headers.get(h);
      if (val) {
        reply.header(h, val);
      }
    }

    // Allow CORS for all downloads
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Headers', 'Range, Authorization, Content-Type');
    reply.header('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

    // Attachment filename header
    if (filename || asAttachment) {
      const safeName = (filename || 'download.mp4').replace(/[^\w.-]/g, '_');
      const disposition = asAttachment ? 'attachment' : 'inline';
      reply.header('Content-Disposition', `${disposition}; filename="${safeName}"`);
    }

    if (!upstream.body) {
      return reply.send();
    }

    // Stream the body using Node Readable stream
    const nodeStream = Readable.fromWeb(upstream.body as any);
    return reply.send(nodeStream);
  } catch (err: any) {
    return reply.status(502).send({
      error: `Proxy failed to connect to upstream: ${err.message}`,
    });
  }
}
