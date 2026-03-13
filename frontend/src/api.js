/* Thin wrapper around fetch that handles auth token automatically */

let _token = sessionStorage.getItem('vd_token') || null;

export const setToken = (token) => {
  _token = token;
  if (token) sessionStorage.setItem('vd_token', token);
  else       sessionStorage.removeItem('vd_token');
};

export const getToken = () => _token;

export const api = async (url, options = {}) => {
  const headers = { ...options.headers };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, { ...options, headers });

  // If 401, clear the stored token (session expired)
  // Skip auto-reload for validate-token (AuthWrapper handles that itself)
  if (res.status === 401 && _token && !url.includes('/api/validate-token')) {
    setToken(null);
    window.location.reload();
  }

  return res;
};
