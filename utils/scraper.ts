import { ScrapedData } from '../types';

const LOCAL_SERVER = 'http://localhost:3001/scrape?url=';

// List of proxies to try in order. 
// Some work better for different sites.
const PROXY_PROVIDERS = [
  // CorsProxy.io is often faster and less blocked
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  // CodeTabs is another alternative
  (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  // AllOrigins is the fallback
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
];

export const isValidUrl = (string: string): boolean => {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
};

const cleanImages = (images: string[], baseUrl: string): string[] => {
    return images
      .map(url => {
        try {
            // Fix Protocol-relative URLs (//example.com)
            if (url.startsWith('//')) return `https:${url}`;
            // Fix escaped slashes often found in extracted JSON
            let cleanUrl = url.replace(/\\/g, '');
            // Remove wrapping quotes if regex caught them
            cleanUrl = cleanUrl.replace(/^['"]|['"]$/g, '');
            // Resolve relative URLs
            return new URL(cleanUrl, baseUrl).href;
        } catch (e) {
            return null;
        }
      })
      .filter((url): url is string => url !== null)
      .filter(url => {
        if (!url.startsWith('http')) return false;
        // Filter out junk
        if (url.includes('.svg') || url.includes('tracker') || url.includes('analytics') || url.includes('facebook') || url.includes('google') || url.includes('whatsapp')) {
           return false;
        }
        // HEURISTIC: Keep P24 images
        if (url.includes('images.prop24.com') || url.includes('property24')) {
            return true;
        }
        // Filter small icons for others
        if (url.includes('icon') || url.includes('logo')) {
            if (!url.includes('property')) return false;
        }
        return true;
      });
};

const fetchWithTimeout = async (url: string, timeout = 8000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
};

const scrapeViaProxies = async (url: string): Promise<ScrapedData> => {
    let html = '';
    let usedProxy = '';
    let fetchError = null;

    // Try proxies sequentially
    for (const getProxyUrl of PROXY_PROVIDERS) {
        try {
            const proxyUrl = getProxyUrl(url);
            const response = await fetchWithTimeout(proxyUrl);
            
            if (response.ok) {
                html = await response.text();
                if (html && html.length > 500) { // Basic validation
                    usedProxy = proxyUrl;
                    break;
                }
            }
        } catch (e) {
            console.warn(`Proxy failed:`, e);
            fetchError = e;
        }
    }

    if (!html) {
        throw new Error(`Failed to fetch content. Sites like Property24 often block cloud proxies. Please run the local server (node server.cjs) for the best experience. Last error: ${fetchError?.message || 'Blocked'}`);
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const imageSet = new Set<string>();

    // 1. Aggressive Regex for JS variables (Common in P24)
    // Matches http(s)://... .jpg|.png|.webp potentially with query params, allowing escaped slashes
    // We removed the requirement for "url:" prefix to catch simple arrays
    const regex = /(https?:\\?\/\\?\/[^"'\s<>;,\[\]\{\}]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s<>;,\[\]\{\}]*)?)/gi;
    
    let match;
    while ((match = regex.exec(html)) !== null) {
        imageSet.add(match[1]);
    }

    // 2. CSS url() regex
    const cssRegex = /url\(['"]?(https?:[^)'"]+\.(?:jpg|jpeg|png|webp)[^)'"]*)['"]?\)/gi;
    while ((match = cssRegex.exec(html)) !== null) {
        imageSet.add(match[1]);
    }
    
    // 3. Standard attributes
    doc.querySelectorAll('img, a, div').forEach(el => {
        const attrs = ['src', 'href', 'data-src', 'data-url', 'data-original', 'data-large-img-url'];
        attrs.forEach(attr => {
            const val = el.getAttribute(attr);
            if (val && (val.match(/\.(jpg|png|webp)/i) || val.includes('images.prop24'))) {
                imageSet.add(val);
            }
        });
        
        // Handle inline styles
        const style = el.getAttribute('style');
        if (style && style.includes('url(')) {
             const m = style.match(/url\(['"]?(.*?)['"]?\)/);
             if (m) imageSet.add(m[1]);
        }
    });

    const { title, text, price } = extractTextFromHtml(html);
    
    return {
        url,
        images: cleanImages(Array.from(imageSet), url),
        title,
        text,
        price
    };
};

const extractTextFromHtml = (html: string): { title: string; text: string; price?: string } => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const scripts = doc.querySelectorAll('script, style, nav, footer, header, noscript, iframe');
    scripts.forEach(s => s.remove());
    
    const title = doc.querySelector('title')?.textContent || 'Untitled';
    const priceMeta = doc.querySelector('.p24_price') || doc.querySelector('[class*="price"]');
    const price = priceMeta ? priceMeta.textContent?.trim() : '';
    
    // Get text but limit length
    const text = doc.body.textContent?.replace(/\s+/g, ' ').trim().substring(0, 10000) || '';
    return { title, text, price };
}

export const scrapeUrl = async (url: string): Promise<ScrapedData> => {
  // 1. Try Local Playwright Server (Best for Property24)
  try {
    const serverUrl = `${LOCAL_SERVER}${encodeURIComponent(url)}`;
    // Short timeout for local server check
    const response = await fetch(serverUrl, { method: 'GET', signal: AbortSignal.timeout(3000) });
    
    if (response.ok) {
        const data = await response.json();
        return {
            url,
            images: cleanImages(data.images, url),
            title: data.title || 'Extracted Property',
            text: data.text || '',
            price: data.price
        };
    }
  } catch (e) {
      // Local server not running, continue to proxy
  }

  // 2. Fallback to Multi-Proxy
  try {
      return await scrapeViaProxies(url);
  } catch (error) {
      return {
          url,
          images: [],
          text: '',
          title: 'Error',
          error: error instanceof Error ? error.message : 'Unknown error'
      };
  }
};