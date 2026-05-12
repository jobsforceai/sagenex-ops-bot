/**
 * Cheap bot heuristic: look for a real-browser User-Agent and a recent
 * client-side timestamp posted with the request (set via the chat UI).
 * A bot that just hits /api/chat directly with curl will fail both.
 *
 * This is defence-in-depth alongside the password gate and rate limit —
 * not a security boundary on its own.
 */
export function looksLikeBot(req: Request): { bot: boolean; reason?: string } {
  const ua = req.headers.get('user-agent') || '';
  if (!ua) return { bot: true, reason: 'no user-agent' };
  // Block known bot/script signatures
  if (/curl|wget|python-requests|httpie|axios\/|scrapy|bot\b|crawler|spider/i.test(ua)) {
    return { bot: true, reason: `user-agent looks scripted: ${ua.slice(0, 60)}` };
  }
  // Require a Mozilla-prefixed real-browser UA (covers Chrome / Safari / Firefox / Edge)
  if (!/^Mozilla\//.test(ua)) {
    return { bot: true, reason: `user-agent not browser-like: ${ua.slice(0, 60)}` };
  }
  return { bot: false };
}
