import { getProvider } from './llm';
import type { JsonSchema } from './llm/schema';

/**
 * Resolve a cover photo for a trip. The LLM picks the best representative
 * subject (English Wikipedia article — usually the primary city), then we pull
 * that page's lead image from the free Wikimedia REST API. Best-effort: returns
 * null on any failure so vacation creation is never blocked.
 */

const SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    wikipediaTitle: {
      type: 'string',
      description:
        'The English Wikipedia article title most likely to have an attractive, representative travel photo of this trip — prefer the main destination city (e.g. "Lisbon"), else the country or a famous landmark.',
    },
  },
  required: ['wikipediaTitle'],
};

const UA = 'JarvisScheduler/1.0 (vacation cover image lookup)';

export async function resolveVacationImage(input: {
  title: string;
  destinations?: string | null;
}): Promise<string | null> {
  try {
    const args = await getProvider().extractStructured({
      system:
        'You choose a Wikipedia article whose lead image best represents a holiday destination.',
      text: `Trip title: ${input.title}\nDestinations: ${input.destinations || '(unspecified)'}`,
      toolName: 'pick_image_subject',
      schema: SCHEMA,
    });
    const title = typeof args.wikipediaTitle === 'string' ? args.wikipediaTitle.trim() : '';
    const subject = title || (input.destinations ?? '').split(',')[0]?.trim() || input.title;
    return await wikipediaLeadImage(subject);
  } catch {
    // Fall back to a keyword lookup without the LLM.
    const subject = (input.destinations ?? '').split(',')[0]?.trim() || input.title;
    try {
      return await wikipediaLeadImage(subject);
    } catch {
      return null;
    }
  }
}

async function wikipediaLeadImage(subject: string): Promise<string | null> {
  if (!subject) return null;
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(subject)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' }, signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      originalimage?: { source?: string; width?: number };
      thumbnail?: { source?: string };
    };
    // Use the URLs Wikimedia actually returns. (Synthesizing arbitrary thumbnail
    // widths is unreliable — uncached sizes 400 on hotlink.) Prefer the original
    // (crisp) unless it's huge, in which case the REST thumbnail is fine.
    const thumb = data.thumbnail?.source ?? null;
    const orig = data.originalimage;
    if (orig?.source && (!orig.width || orig.width <= 2600)) return orig.source;
    return thumb ?? orig?.source ?? null;
  } finally {
    clearTimeout(t);
  }
}
