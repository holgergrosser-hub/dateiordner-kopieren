export async function handler(event) {
  const startedAt = Date.now()
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }

  const TIMEOUT_MS = 8000

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: '',
    }
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ success: false, message: 'Method not allowed' }),
    }
  }

  const gasUrl = (process.env.GAS_URL || process.env.VITE_GAS_URL || '').trim()
  if (!gasUrl) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        success: false,
        message: 'GAS_URL is not configured on the server. Set GAS_URL or VITE_GAS_URL in Netlify environment variables.',
      }),
    }
  }

  let payload
  try {
    payload = event.body ? JSON.parse(event.body) : {}
  } catch {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ success: false, message: 'Invalid JSON body' }),
    }
  }

  const action = payload?.action
  const params = payload?.params && typeof payload.params === 'object' ? payload.params : {}

  if (!action) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ success: false, message: 'Missing action' }),
    }
  }

  console.log(
    JSON.stringify({
      msg: 'gas-proxy request',
      action,
      paramsKeys: Object.keys(params || {}).length,
    })
  )

  try {
    const formBody = new URLSearchParams()
    formBody.append('action', action)
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue
      formBody.append(key, String(value))
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

    let response
    try {
      response = await fetch(gasUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body: formBody.toString(),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }

    console.log(
      JSON.stringify({
        msg: 'gas-proxy upstream',
        action,
        status: response?.status,
        durationMs: Date.now() - startedAt,
      })
    )

    const text = await response.text()

    // Prefer JSON coming back from GAS; otherwise wrap it.
    let json
    try {
      json = JSON.parse(text)
    } catch {
      const snippet = text ? text.slice(0, 300) : ''
      json = {
        success: false,
        message: `GAS returned non-JSON response (HTTP ${response.status}).`,
        snippet,
      }
    }

    if (!response.ok && json && typeof json === 'object' && json.success !== true) {
      json = {
        success: false,
        message: json.message || `GAS request failed (HTTP ${response.status}).`,
        status: response.status,
      }
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(json),
    }
  } catch (err) {
    const isAbort =
      err?.name === 'AbortError' ||
      String(err?.message || '').toLowerCase().includes('aborted')

    if (isAbort) {
      console.log(
        JSON.stringify({
          msg: 'gas-proxy timeout',
          action,
          durationMs: Date.now() - startedAt,
        })
      )
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          success: false,
          action,
          message:
            `Timeout waiting for GAS after ${TIMEOUT_MS}ms (action: ${action}). ` +
            'This usually means the Apps Script action is slow (e.g. copying a large folder). ' +
            'Reduce folder size, or change the Apps Script to run the long task asynchronously (jobId + polling).',
        }),
      }
    }

    console.log(
      JSON.stringify({
        msg: 'gas-proxy error',
        action,
        durationMs: Date.now() - startedAt,
        error: String(err?.message || err),
      })
    )

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        success: false,
        message: `Proxy error: ${err?.message || String(err)}`,
      }),
    }
  }
}
