/**
 * Thin API client.
 *
 * The token lives in localStorage: simple, and adequate here because the API is
 * stateless and CSRF-free. A production deployment handling real case material
 * should move to an httpOnly cookie so a script injection cannot read it.
 */

const BASE = import.meta.env.VITE_API_BASE || ''
const API = `${BASE}/api`
const TOKEN_KEY = 'dfd.token'
const USER_KEY = 'dfd.user'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null')
  } catch {
    return null
  }
}

export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

async function request(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const token = getToken()
  const options = {
    method,
    headers: {
      ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  }
  if (body) options.body = body instanceof FormData ? body : JSON.stringify(body)

  const response = await fetch(`${API}${path}`, options)
  if (raw) {
    if (!response.ok) throw new ApiError(await errorText(response), response.status)
    return response
  }

  if (response.status === 204) return null
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ApiError(payload.detail || `Request failed (${response.status})`, response.status)
  }
  return payload
}

async function errorText(response) {
  try {
    const payload = await response.json()
    return payload.detail || `Request failed (${response.status})`
  } catch {
    return `Request failed (${response.status})`
  }
}

export const api = {
  health: () => request('/health'),
  limits: () => request('/upload/limits'),

  register: (data) => request('/auth/register', { method: 'POST', body: data }),
  login: (data) => request('/auth/login', { method: 'POST', body: data }),
  me: () => request('/auth/me'),

  upload: (file, onProgress) => uploadWithProgress(file, onProgress),
  jobStatus: (id) => request(`/jobs/${id}/status`),
  jobResult: (id) => request(`/jobs/${id}/result`),
  createReport: (id) => request(`/jobs/${id}/report`, { method: 'POST' }),
  reportUrl: (id) => `${API}/jobs/${id}/report`,
  evidenceUrl: (path) => `${BASE}${path}`,
  verifyReport: (reference) => request(`/reports/${reference}/verify`),

  history: (limit = 20, offset = 0) => request(`/history?limit=${limit}&offset=${offset}`),
  deleteScan: (id) => request(`/history/${id}`, { method: 'DELETE' }),
}

/**
 * Uploads via XHR rather than fetch: fetch cannot report upload progress, and a
 * 100 MB video with no progress bar looks like a frozen page.
 */
function uploadWithProgress(file, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API}/upload`)
    const token = getToken()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
    xhr.onload = () => {
      let payload = {}
      try {
        payload = JSON.parse(xhr.responseText)
      } catch {
        /* non-JSON error body */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(payload)
      else reject(new ApiError(payload.detail || `Upload failed (${xhr.status})`, xhr.status))
    }
    xhr.onerror = () => reject(new ApiError('Network error during upload', 0))
    xhr.send(form)
  })
}

/** Poll a job until it leaves the queued/processing states. */
export async function pollJob(jobId, { intervalMs = 1500, timeoutMs = 15 * 60 * 1000, onTick } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const status = await api.jobStatus(jobId)
    if (onTick) onTick(status)
    if (status.status === 'done') return api.jobResult(jobId)
    if (status.status === 'failed') {
      throw new ApiError(status.error_message || 'Analysis failed.', 409)
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new ApiError('Timed out waiting for the analysis to finish.', 408)
}
