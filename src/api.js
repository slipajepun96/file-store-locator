// Called when the server says the session is gone, so the app can show the login page.
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

// body is sent as JSON, or as-is when it's a Blob (e.g. a photo, with the Blob's own type).
async function request(method, url, body) {
  const isBlob = body instanceof Blob;
  let res;
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': isBlob ? body.type : 'application/json' } : undefined,
      body: body ? (isBlob ? body : JSON.stringify(body)) : undefined,
    });
  } catch {
    // The server couldn't be reached at all (no connection, or it's down): say so plainly.
    const err = new Error(navigator.onLine ? "Couldn't reach the server. Try again in a moment." : "You're offline. Connect to the internet and try again.");
    err.offline = true;
    throw err;
  }
  if (res.status === 401 && url !== '/auth/login' && url !== '/auth/me') onUnauthorized();
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
};
