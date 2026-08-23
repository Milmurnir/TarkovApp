const WIKI = '/api/wiki';
const CACHE_PREFIX = 'eft-quest-guide-v1:';
const WIKI_ORIGIN = 'https://escapefromtarkov.fandom.com';

/**
 * The wiki's own rendered Guide section: the Related Quest Items table, the
 * written walkthrough, and the screenshots.
 *
 * Reproducing that from wikitext would lose the tables and image galleries, so
 * the rendered HTML is taken from the API and cleaned up instead:
 *
 *  - only the Guide section is kept (it starts with the quest items table)
 *  - scripts, styles, edit links and navigation boxes are stripped
 *  - images are lazy-loaded on the wiki, with the real URL in `data-src`
 *  - links are made absolute and open in a browser rather than in the app
 */
export interface QuestGuide {
  title: string;
  html: string;
  images: number;
}

function sanitize(sectionNodes: Node[]): { html: string; images: number } {
  const container = document.createElement('div');
  for (const node of sectionNodes) container.appendChild(node.cloneNode(true));

  container.querySelectorAll('script, style, noscript, iframe, object, embed').forEach((el) => el.remove());
  container.querySelectorAll('.mw-editsection, .navbox, .toc, .mw-empty-elt').forEach((el) => el.remove());

  // Drop any inline handlers that came with the markup.
  container.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.toLowerCase().startsWith('on')) el.removeAttribute(attr.name);
    }
  });

  let images = 0;
  container.querySelectorAll('img').forEach((img) => {
    const real = img.getAttribute('data-src');
    if (real) img.setAttribute('src', real);
    img.removeAttribute('srcset');
    img.removeAttribute('data-src');
    img.removeAttribute('loading');
    img.classList.remove('lazyload');
    const src = img.getAttribute('src') ?? '';
    // A leftover placeholder has no useful content.
    if (src.startsWith('data:')) img.remove();
    else images += 1;
  });

  container.querySelectorAll('a').forEach((a) => {
    const href = a.getAttribute('href');
    if (href && href.startsWith('/')) a.setAttribute('href', WIKI_ORIGIN + href);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noreferrer');
  });

  return { html: container.innerHTML, images };
}

/** Everything from the Guide heading to the end of the article. */
function extractGuide(pageHtml: string): { html: string; images: number } | null {
  const doc = new DOMParser().parseFromString(pageHtml, 'text/html');
  const heading = doc.querySelector('#Guide')?.closest('h2')
    ?? doc.querySelector('#Guide')?.parentElement;
  if (!heading) return null;

  const nodes: Node[] = [];
  let node = heading.nextSibling;
  while (node) {
    // Guide is the last section on quest pages, but stop at another one anyway.
    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'H2') break;
    nodes.push(node);
    node = node.nextSibling;
  }
  if (nodes.length === 0) return null;
  return sanitize(nodes);
}

export async function fetchQuestGuide(title: string): Promise<QuestGuide | null> {
  const cacheKey = CACHE_PREFIX + title;
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) return JSON.parse(raw) as QuestGuide;
  } catch { /* refetch on any cache problem */ }

  const params = new URLSearchParams({
    format: 'json', origin: '*', action: 'parse', page: title, prop: 'text', redirects: '1',
  });
  const response = await fetch(`${WIKI}?${params.toString()}`);
  if (!response.ok) throw new Error(`Wiki request failed (${response.status})`);

  const data = await response.json();
  if (data?.error) throw new Error(data.error.info ?? `No wiki page for "${title}"`);

  const pageHtml = data?.parse?.text?.['*'];
  if (typeof pageHtml !== 'string') return null;

  const extracted = extractGuide(pageHtml);
  if (!extracted) return null;

  const guide: QuestGuide = { title, html: extracted.html, images: extracted.images };
  try {
    localStorage.setItem(cacheKey, JSON.stringify(guide));
  } catch { /* guides can be large; caching is best-effort */ }
  return guide;
}
