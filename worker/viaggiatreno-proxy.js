/**
 * EasyTreno — Optional Free Cloudflare Worker CORS Proxy for Viaggiatreno
 *
 * Deploy on a free Cloudflare Workers account (100,000 req/day free) and paste
 * the resulting https://<name>.<subdomain>.workers.dev URL into EasyTreno Settings
 * to get inline live delays (ritardi) and live platforms (binari) on any station.
 */

const ALLOWED_PREFIX = 'http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/';

export default {
  async fetch(request) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, '');
    if (!path || !/^(partenze|arrivi|andamentoTreno|autocompletaStazione)\//.test(path)) {
      return new Response(JSON.stringify({ error: 'Endpoint non consentito' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const upstream = ALLOWED_PREFIX + path;
    const res = await fetch(upstream, {
      headers: { 'User-Agent': 'Mozilla/5.0 EasyTreno/1.0' },
    });

    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        ...corsHeaders,
        'Content-Type': res.headers.get('Content-Type') || 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=30',
      },
    });
  },
};
