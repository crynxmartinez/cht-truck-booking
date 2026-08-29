import { config } from './config';

/**
 * The CRM is open to anyone who can reach it — there is no staff login. The
 * only guard left here is the cron endpoint, which Vercel hits with a shared
 * secret as a bearer token.
 */

/** Guards the cron endpoint. Vercel sends the secret as a bearer token. */
export function isAuthorisedCron(req: Request): boolean {
  if (!config.cronSecret) return process.env.NODE_ENV !== 'production';
  const header = req.headers.get('authorization') ?? '';
  const url = new URL(req.url);
  return header === `Bearer ${config.cronSecret}` || url.searchParams.get('key') === config.cronSecret;
}
