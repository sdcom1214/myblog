export function securityHeaders({ development = false } = {}) {
  const connect = development ? "'self' ws: wss:" : "'self'";
  return {
    'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src ${connect}; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}
