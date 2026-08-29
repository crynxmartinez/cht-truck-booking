import type { MetadataRoute } from 'next';

/**
 * Nothing here should ever be indexed. The signing and checklist pages are
 * tokenised links meant for one person, and the CRM has no login — so the
 * deployment URL is the only thing keeping the board private. Crawlers stay out.
 *
 * This is a request, not a control: a badly behaved crawler ignores it. It pairs
 * with `robots: { index: false }` in the root layout, which emits the header
 * well-behaved engines actually honour.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }],
  };
}
