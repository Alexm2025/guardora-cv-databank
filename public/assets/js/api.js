// Talks to the Guardora server. Every call carries the session cookie; nothing sensitive is kept in the browser.

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let onSignedOut = () => {};
export const setSignedOutHandler = (fn) => { onSignedOut = fn; };

export async function api(path, { method = 'GET', body, form, signal } = {}) {
  const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json' }, signal };
  if (form) opts.body = form;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch('/api' + path, opts);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'Cannot reach the server. Check your internet connection.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/login') && !path.startsWith('/session')) onSignedOut();
  if (!res.ok || data.ok === false) throw new ApiError(res.status, data.error || 'Request failed (' + res.status + ').');
  return data;
}

export const qs = (obj) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) p.set(k, Array.isArray(v) ? v.join(',') : v);
  const s = p.toString();
  return s ? '?' + s : '';
};

export async function fetchBlob(path) {
  const res = await fetch('/api' + path, { credentials: 'same-origin' });
  if (res.status === 401) onSignedOut();
  if (!res.ok) throw new ApiError(res.status, 'Could not load the file.');
  return res.blob();
}
