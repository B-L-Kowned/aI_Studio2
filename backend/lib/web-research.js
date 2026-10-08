import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_BYTES = 1_000_000;
const MAX_TEXT = 30_000;
const MAX_REDIRECTS = 4;

const decode = (s = '') => String(s)
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)));

const clean = (s = '') => decode(s)
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function privateIpv4(ip) {
  const p = ip.split('.').map(Number);
  return p[0] === 10
    || p[0] === 127
    || p[0] === 0
    || (p[0] === 169 && p[1] === 254)
    || (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
    || (p[0] === 192 && p[1] === 168)
    || (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
    || p[0] >= 224;
}

function privateIp(ip) {
  if (isIP(ip) === 4) return privateIpv4(ip);
  if (isIP(ip) !== 6) return true;
  const x = ip.toLowerCase();
  if (x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8')
    || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb')) return true;
  const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
  return mapped ? privateIpv4(mapped[1]) : false;
}

export function normaliseWebsiteUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw Object.assign(new Error('Enter the website URL.'), { code: 'URL_REQUIRED' });
  let url;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); }
  catch { throw Object.assign(new Error('That is not a valid website URL.'), { code: 'BAD_URL' }); }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw Object.assign(new Error('Only http and https website URLs are supported.'), { code: 'BAD_URL' });
  }
  url.hash = '';
  return url;
}

async function assertPublic(url, resolveHost = lookup) {
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw Object.assign(new Error('Local and private-network URLs cannot be researched.'), { code: 'PRIVATE_URL' });
  }
  if (isIP(host)) {
    if (privateIp(host)) throw Object.assign(new Error('Local and private-network URLs cannot be researched.'), { code: 'PRIVATE_URL' });
    return;
  }
  let addresses;
  try { addresses = await resolveHost(host, { all: true, verbatim: true }); }
  catch { throw Object.assign(new Error(`Could not resolve ${host}.`), { code: 'UNREACHABLE' }); }
  if (!addresses.length || addresses.some((a) => privateIp(a.address))) {
    throw Object.assign(new Error('The URL resolves to a local or private network.'), { code: 'PRIVATE_URL' });
  }
}

function meta(html, name) {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const key = /(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (key !== name.toLowerCase()) continue;
    return clean(/content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? '');
  }
  return '';
}

export function extractWebsiteEvidence(html, url) {
  const withoutNoise = String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|svg|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ');
  const title = clean(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(withoutNoise)?.[1] ?? '');
  const description = meta(withoutNoise, 'description') || meta(withoutNoise, 'og:description');
  const headings = [...withoutNoise.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map((m) => clean(m[2])).filter(Boolean).slice(0, 20);
  const paragraphs = [...withoutNoise.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => clean(m[1])).filter((x) => x.length >= 35).slice(0, 30);
  const text = clean(withoutNoise).slice(0, MAX_TEXT);
  const canonical = meta(withoutNoise, 'og:url') || url.href;
  const siteName = meta(withoutNoise, 'og:site_name');
  const summary = (description || paragraphs[0] || text.slice(0, 500)).slice(0, 1000);
  return { title, description, siteName, canonical, headings, paragraphs, text, summary };
}

export function suggestedBrief(url, evidence) {
  const brand = evidence.siteName || evidence.title.split(/[|–—-]/)[0].trim() || url.hostname;
  return {
    Website: url.href,
    Brand: brand.slice(0, 200),
    'Source summary': evidence.summary.slice(0, 500),
    CTA: `Visit ${url.hostname}`,
  };
}

export async function researchWebsite(input, { fetchImpl = fetch, resolveHost = lookup } = {}) {
  let url = normaliseWebsiteUrl(input);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(url, resolveHost);
    const response = await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(12_000),
      headers: {
        'User-Agent': 'AI-Video-Studio/0.1 website-research',
        Accept: 'text/html,text/plain;q=0.8',
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get('location');
      if (!next) throw Object.assign(new Error('The website redirected without a destination.'), { code: 'BAD_REDIRECT' });
      url = new URL(next, url);
      continue;
    }
    if (!response.ok) {
      throw Object.assign(new Error(`The website answered ${response.status}.`), { code: 'FETCH_FAILED' });
    }
    const type = response.headers.get('content-type') ?? '';
    if (!/text\/(html|plain)|application\/xhtml\+xml/i.test(type)) {
      throw Object.assign(new Error(`The URL returned ${type || 'a non-text file'}, not a web page.`), { code: 'NOT_HTML' });
    }
    const announced = Number(response.headers.get('content-length'));
    if (Number.isFinite(announced) && announced > MAX_BYTES) {
      throw Object.assign(new Error('The page is too large to research safely.'), { code: 'TOO_LARGE' });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) {
      throw Object.assign(new Error('The page is too large to research safely.'), { code: 'TOO_LARGE' });
    }
    const html = new TextDecoder().decode(bytes);
    const evidence = extractWebsiteEvidence(html, url);
    if (!evidence.text) throw Object.assign(new Error('The page contained no readable text.'), { code: 'NO_TEXT' });
    return { url: url.href, evidence, suggestedBrief: suggestedBrief(url, evidence) };
  }
  throw Object.assign(new Error('The website redirected too many times.'), { code: 'TOO_MANY_REDIRECTS' });
}
