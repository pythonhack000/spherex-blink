// Thin client for the server's JSON and binary endpoints.
import { decodeFrames } from './stack.js';

async function request(path, params = {}) {
  const query = new URLSearchParams(params).toString();
  const response = await fetch(query ? `${path}?${query}` : path);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = typeof body.detail === 'string' ? body.detail : response.statusText;
    throw Object.assign(new Error(detail), { status: response.status });
  }
  return response;
}

const json = async (path, params) => (await request(path, params)).json();

export const getPresets = () => json('/api/presets');
export const parsePosition = (text) => json('/api/parse', { text });
export const resolveName = (q) => json('/api/resolve', { q });
export const observe = (ra, dec, fov) => json('/api/observe', { ra, dec, fov });
export const jobStatus = (id) => json(`/api/job/${id}`);
export const getSpectrum = (id, params) => json(`/api/job/${id}/spectrum`, params);
export const getMotion = (id, params) => json(`/api/job/${id}/motion`, params);
export const getGaia = (ra, dec, fov) => json('/api/gaia', { ra, dec, fov });

export async function getFrames(id, start, size) {
  const buffer = await (await request(`/api/job/${id}/frames`, { start })).arrayBuffer();
  return decodeFrames(buffer, size);
}

export async function getWiseFrame(id, size) {
  const buffer = await (await request(`/api/job/${id}/wise`)).arrayBuffer();
  const headerLength = new DataView(buffer).getUint32(0, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength)));
  return { ...meta, pixels: new Float32Array(buffer, 4 + headerLength, size * size) };
}
