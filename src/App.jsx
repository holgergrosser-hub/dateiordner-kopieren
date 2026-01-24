import { useState } from 'react'

// Google Apps Script Web App URL
// Lokal: in `.env` setzen als VITE_GAS_URL=https://...
// Netlify: Site settings → Environment variables → VITE_GAS_URL
const GAS_URL = import.meta?.env?.VITE_GAS_URL || ''

// Hilfsfunktion: Datum-Muster im Dateinamen finden
const findDatePatterns = (fileName) => {
  const patterns = [
    /\d{4}-\d{2}-\d{2}/g, // 2025-01-15
    /\d{2}\.\d{2}\.\d{4}/g, // 15.01.2025
    /\d{2}_\d{2}_\d{4}/g, // 15_01_2025
    /Stand[:\s_]*[\d\.-]+/gi, // Stand: 2025-01-15 oder Stand: 15.01.2025
  ]

  const matches = []
  for (const pattern of patterns) {
    const found = fileName.match(pattern)
    if (found) matches.push(...found)
  }
  return [...new Set(matches)]
}

// Styles
const styles = {
  body: {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    minHeight: '100vh',
    margin: 0,
    padding: '40px 20px',
  },
  container: {
    maxWidth: '900px',
    margin: '0 auto',
    background: 'white',
    borderRadius: '20px',
    boxShadow: '0 25px 80px rgba(0,0,0,0.3)',
    overflow: 'hidden',
  },
  header: {
    background: 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)',
    color: 'white',
    padding: '30px',
    textAlign: 'center',
  },
  title: {
    margin: 0,
    fontSize: '28px',
    fontWeight: 700,
  },
  subtitle: {
    margin: '10px 0 0',
    opacity: 0.9,
    fontSize: '16px',
  },
  content: {
    padding: '40px',
  },
  stepper: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '40px',
    position: 'relative',
  },
  stepperLine: {
    position: 'absolute',
    top: '20px',
    left: '60px',
    right: '60px',
    height: '3px',
    background: '#e0e0e0',
    zIndex: 0,
  },
  step: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    position: 'relative',
    zIndex: 1,
    flex: 1,
  },
  stepCircle: (active, completed) => ({
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    background: completed ? '#28a745' : active ? '#667eea' : '#e0e0e0',
    color: completed || active ? 'white' : '#666',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 600,
    fontSize: '16px',
    transition: 'all 0.3s ease',
  }),
  stepLabel: (active) => ({
    marginTop: '10px',
    fontSize: '13px',
    fontWeight: active ? 600 : 400,
    color: active ? '#333' : '#666',
    textAlign: 'center',
  }),
  card: {
    background: '#f8f9fa',
    borderRadius: '15px',
    padding: '30px',
    marginBottom: '20px',
  },
  inputGroup: {
    marginBottom: '20px',
  },
  label: {
    display: 'block',
    marginBottom: '8px',
    fontWeight: 600,
    color: '#333',
  },
  input: {
    width: '100%',
    padding: '14px 18px',
    border: '2px solid #e0e0e0',
    borderRadius: '10px',
    fontSize: '16px',
    transition: 'all 0.3s ease',
    boxSizing: 'border-box',
  },
  button: (variant = 'primary', disabled = false) => ({
    background: disabled
      ? '#ccc'
      : variant === 'primary'
        ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
        : variant === 'success'
          ? 'linear-gradient(135deg, #28a745 0%, #1e7e34 100%)'
          : '#6c757d',
    color: 'white',
    border: 'none',
    padding: '14px 30px',
    borderRadius: '10px',
    fontSize: '16px',
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'all 0.3s ease',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
  }),
  fileList: {
    maxHeight: '350px',
    overflowY: 'auto',
    border: '1px solid #e0e0e0',
    borderRadius: '10px',
    background: 'white',
  },
  fileItem: {
    padding: '12px 16px',
    borderBottom: '1px solid #f0f0f0',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '14px',
  },
  alert: (type) => ({
    padding: '15px 20px',
    borderRadius: '10px',
    marginBottom: '20px',
    background: type === 'success' ? '#d4edda' : type === 'error' ? '#f8d7da' : '#d1ecf1',
    color: type === 'success' ? '#155724' : type === 'error' ? '#721c24' : '#0c5460',
  }),
  dateBadge: (selected) => ({
    display: 'inline-block',
    padding: '8px 16px',
    margin: '5px',
    background: selected ? '#667eea' : '#fff3cd',
    color: selected ? 'white' : '#856404',
    borderRadius: '20px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '14px',
    fontWeight: 600,
    transition: 'all 0.2s ease',
    border: selected ? '2px solid #667eea' : '2px solid #ffc107',
  }),
  spinner: {
    display: 'inline-block',
    width: '20px',
    height: '20px',
    border: '3px solid rgba(255,255,255,0.3)',
    borderTop: '3px solid white',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  infoBox: {
    background: '#e3f2fd',
    border: '1px solid #90caf9',
    borderRadius: '10px',
    padding: '15px',
    marginBottom: '20px',
    color: '#1565c0',
  },
}

const spinnerCSS = `
@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
`

export default function App() {
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  // Step 1: Ordner kopieren
  const [sourceUrl, setSourceUrl] = useState('')
  const [newFolderName, setNewFolderName] = useState('')
  const [sourceFolderName, setSourceFolderName] = useState('')
  const [loadingInfo, setLoadingInfo] = useState(false)

  // Step 2 & 3: Arbeiten im ALT-ORDNER
  const [sourceFolderId, setSourceFolderId] = useState(null)
  const [copiedFolderId, setCopiedFolderId] = useState(null)
  const [files, setFiles] = useState([])
  const [detectedDates, setDetectedDates] = useState([])
  const [selectedText, setSelectedText] = useState('')
  const [customSearch, setCustomSearch] = useState('')

  // Step 3: Umbenennung
  const [replaceWith, setReplaceWith] = useState('')

  // API Call Helper - FormData (kein Content-Type Header!)
  const callAPI = async (action, params = {}) => {
    if (!GAS_URL) {
      throw new Error(
        'GAS URL fehlt. Bitte VITE_GAS_URL setzen (Netlify Environment Variables oder lokal in .env).'
      )
    }

    const formData = new FormData()
    formData.append('action', action)
    Object.keys(params).forEach((key) => {
      formData.append(key, params[key])
    })

    const response = await fetch(GAS_URL, {
      method: 'POST',
      body: formData,
    })

    const contentType = response.headers.get('content-type') || ''

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '')
      const snippet = bodyText ? ` Details: ${bodyText.slice(0, 200)}` : ''
      throw new Error(`HTTP ${response.status} (${response.statusText}).${snippet}`)
    }

    if (contentType.includes('application/json')) {
      return response.json()
    }

    // Häufigster Fall bei falscher URL: HTML (Netlify index.html) statt JSON
    const bodyText = await response.text().catch(() => '')
    const snippet = bodyText ? bodyText.slice(0, 200) : ''
    throw new Error(`Antwort ist kein JSON. ${snippet}`)
  }

  // Ordner-Info laden (Name + Backup-Vorschlag)
  const loadFolderInfo = async (url) => {
    if (!url || url.length < 20) return

    setLoadingInfo(true)
    setError(null)

    try {
      const result = await callAPI('getFolderInfo', { sourceUrl: url })

      if (result.success) {
        setSourceFolderName(result.folderName)
        setNewFolderName(result.suggestedBackupName)
        setSuccess(`📂 Ordner gefunden: "${result.folderName}"`)
      } else {
        setError(result.message || 'Ordner nicht gefunden')
      }
    } catch (err) {
      setError('Verbindungsfehler: ' + err.message)
    } finally {
      setLoadingInfo(false)
    }
  }

  // Step 1: Ordner kopieren
  const handleCopyFolder = async () => {
    if (!sourceUrl || !newFolderName) {
      setError('Bitte alle Felder ausfüllen')
      return
    }

    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const result = await callAPI('copyFolder', {
        sourceUrl,
        newFolderName,
      })

      if (result.success) {
        setSourceFolderId(result.sourceFolderId)
        setCopiedFolderId(result.folderId)
        setFiles(result.sourceFiles || [])

        // Datums-Muster finden
        const allDates = []
        for (const file of result.sourceFiles || []) {
          allDates.push(...findDatePatterns(file.name))
        }
        setDetectedDates([...new Set(allDates)])

        setSuccess(`✅ Kopie "${newFolderName}" erstellt! Jetzt arbeiten wir im Alt-Ordner.`)
        setStep(2)
      } else {
        setError(result.message || 'Fehler beim Kopieren')
      }
    } catch (err) {
      setError('Verbindungsfehler: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  // Datum/Text auswählen
  const selectSearchText = (text) => {
    setSelectedText(text)
    setCustomSearch('')
    setError(null)
  }

  // Weiter zu Schritt 3
  const goToStep3 = () => {
    const searchText = customSearch || selectedText
    if (!searchText) {
      setError('Bitte einen Text zum Ersetzen auswählen oder eingeben')
      return
    }
    setSelectedText(searchText)
    setStep(3)
  }

  // Step 3: Dateien im ALT-ORDNER umbenennen
  const handleRename = async () => {
    if (!replaceWith) {
      setError('Bitte den neuen Text eingeben')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await callAPI('renameFiles', {
        folderId: sourceFolderId,
        searchPattern: selectedText,
        replacePattern: replaceWith,
      })

      if (result.success) {
        setSuccess(`✅ ${result.renamedCount} Dateien im Alt-Ordner umbenannt!`)
        setFiles(result.files || [])
      } else {
        setError(result.message || 'Fehler beim Umbenennen')
      }
    } catch (err) {
      setError('Verbindungsfehler: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  // Neustart
  const handleReset = () => {
    setStep(1)
    setSourceUrl('')
    setNewFolderName('')
    setSourceFolderName('')
    setSourceFolderId(null)
    setCopiedFolderId(null)
    setFiles([])
    setDetectedDates([])
    setSelectedText('')
    setCustomSearch('')
    setReplaceWith('')
    setError(null)
    setSuccess(null)
  }

  return (
    <div style={styles.body}>
      <style>{spinnerCSS}</style>

      <div style={styles.container}>
        <div style={styles.header}>
          <h1 style={styles.title}>📁 Ordner Kopieren & Umbenennen</h1>
          <p style={styles.subtitle}>Kopie erstellen, dann im Original umbenennen</p>
        </div>

        <div style={styles.content}>
          {/* Stepper */}
          <div style={styles.stepper}>
            <div style={styles.stepperLine} />

            <div style={styles.step}>
              <div style={styles.stepCircle(step === 1, step > 1)}>{step > 1 ? '✓' : '1'}</div>
              <div style={styles.stepLabel(step === 1)}>
                Ordner kopieren
                <br />(Backup)
              </div>
            </div>

            <div style={styles.step}>
              <div style={styles.stepCircle(step === 2, step > 2)}>{step > 2 ? '✓' : '2'}</div>
              <div style={styles.stepLabel(step === 2)}>
                Dateien anzeigen
                <br />(Alt-Ordner)
              </div>
            </div>

            <div style={styles.step}>
              <div style={styles.stepCircle(step === 3, false)}>3</div>
              <div style={styles.stepLabel(step === 3)}>
                Umbenennen
                <br />(Alt-Ordner)
              </div>
            </div>
          </div>

          {/* Messages */}
          {!GAS_URL && (
            <div style={styles.alert('error')}>
              ❌ <strong>Konfiguration fehlt:</strong> Setze <code>VITE_GAS_URL</code> auf die URL deiner Google Apps Script
              Web-App (z.B. endet oft mit <code>/exec</code>). Danach neu deployen.
            </div>
          )}
          {error && <div style={styles.alert('error')}>❌ {error}</div>}
          {success && <div style={styles.alert('success')}>{success}</div>}

          {/* Step 1: Ordner kopieren */}
          {step === 1 && (
            <div style={styles.card}>
              <h2 style={{ marginTop: 0, marginBottom: '20px' }}>📋 Schritt 1: Alt-Ordner kopieren (Backup)</h2>

              <div style={styles.infoBox}>
                💡 <strong>Hinweis:</strong> Zuerst wird eine Kopie als Backup erstellt. Danach arbeiten wir im{' '}
                <strong>Alt-Ordner</strong> (Original).
              </div>

              <div style={styles.inputGroup}>
                <label style={styles.label}>Alt-Ordner URL:</label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input
                    type="text"
                    style={{ ...styles.input, flex: 1 }}
                    placeholder="https://drive.google.com/drive/folders/..."
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                    onBlur={(e) => loadFolderInfo(e.target.value)}
                  />
                  <button
                    style={{
                      ...styles.button('secondary', loadingInfo),
                      padding: '14px 20px',
                      whiteSpace: 'nowrap',
                    }}
                    onClick={() => loadFolderInfo(sourceUrl)}
                    disabled={loadingInfo || !sourceUrl}
                  >
                    {loadingInfo ? '...' : '🔍 Laden'}
                  </button>
                </div>
              </div>

              {/* Gefundener Ordnername */}
              {sourceFolderName && (
                <div
                  style={{
                    background: '#d4edda',
                    border: '1px solid #c3e6cb',
                    borderRadius: '10px',
                    padding: '15px',
                    marginBottom: '20px',
                    color: '#155724',
                  }}
                >
                  <strong>📂 Gefundener Ordner:</strong> {sourceFolderName}
                </div>
              )}

              <div style={styles.inputGroup}>
                <label style={styles.label}>Name für die Kopie (Backup):</label>
                <input
                  type="text"
                  style={styles.input}
                  placeholder="z.B. Nachweise_2024 (Jahr -1)"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                />
                <small style={{ color: '#666', marginTop: '5px', display: 'block' }}>
                  💡 Vorschlag: Gleiches wie Alt-Ordner, aber Jahr -1
                </small>
              </div>

              <button
                style={styles.button('primary', loading || !sourceUrl || !newFolderName)}
                onClick={handleCopyFolder}
                disabled={loading || !sourceUrl || !newFolderName}
              >
                {loading && <span style={styles.spinner} />}
                {loading ? 'Wird kopiert...' : '📁 Kopieren & weiter'}
              </button>
            </div>
          )}

          {/* Step 2: Dateien im Alt-Ordner anzeigen */}
          {step === 2 && (
            <div style={styles.card}>
              <h2 style={{ marginTop: 0, marginBottom: '10px' }}>📄 Schritt 2: Dateien im Alt-Ordner</h2>

              <div style={styles.infoBox}>
                📂 <strong>Alt-Ordner:</strong> Hier werden die Dateien umbenannt.
                <br />
                💾 <strong>Backup:</strong> "{newFolderName}" wurde als Sicherung erstellt.
              </div>

              {/* Erkannte Datums-Muster */}
              {detectedDates.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <label style={styles.label}>🗓️ Erkannte Datums-Muster (klicken zum Auswählen):</label>
                  <div>
                    {detectedDates.map((date, i) => (
                      <span key={i} style={styles.dateBadge(selectedText === date)} onClick={() => selectSearchText(date)}>
                        {date}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Oder eigenen Text eingeben */}
              <div style={styles.inputGroup}>
                <label style={styles.label}>Oder eigenen Such-Text eingeben:</label>
                <input
                  type="text"
                  style={styles.input}
                  placeholder="z.B. 2025-01-15 oder _Kunde_"
                  value={customSearch}
                  onChange={(e) => {
                    setCustomSearch(e.target.value)
                    setSelectedText('')
                  }}
                />
              </div>

              {/* Dateiliste */}
              <label style={styles.label}>Dateien im Alt-Ordner ({files.length}):</label>
              <div style={styles.fileList}>
                {files.map((file, index) => {
                  const searchText = customSearch || selectedText
                  const highlighted = searchText && file.name.includes(searchText)

                  return (
                    <div
                      key={file.id || index}
                      style={{
                        ...styles.fileItem,
                        background: highlighted ? '#fff3cd' : 'white',
                      }}
                    >
                      <span>📄</span>
                      <span style={{ flex: 1, wordBreak: 'break-all' }}>
                        {searchText
                          ? file.name.split(searchText).map((part, i, arr) => (
                              <span key={i}>
                                {part}
                                {i < arr.length - 1 && (
                                  <mark style={{ background: '#ffc107', padding: '0 2px' }}>{searchText}</mark>
                                )}
                              </span>
                            ))
                          : file.name}
                      </span>
                    </div>
                  )
                })}
              </div>

              {(selectedText || customSearch) && (
                <div style={{ ...styles.alert('info'), marginTop: '20px' }}>
                  <strong>Wird ersetzt:</strong> "{customSearch || selectedText}"
                </div>
              )}

              <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
                <button style={styles.button('secondary')} onClick={() => setStep(1)}>
                  ← Zurück
                </button>
                <button
                  style={styles.button('primary', !selectedText && !customSearch)}
                  onClick={goToStep3}
                  disabled={!selectedText && !customSearch}
                >
                  Weiter →
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Umbenennen im Alt-Ordner */}
          {step === 3 && (
            <div style={styles.card}>
              <h2 style={{ marginTop: 0, marginBottom: '20px' }}>🔄 Schritt 3: Umbenennen im Alt-Ordner</h2>

              <div style={styles.infoBox}>
                ⚠️ <strong>Achtung:</strong> Die Umbenennung erfolgt im <strong>Original-Ordner</strong> (Alt-Ordner).
                <br />
                Das Backup "{newFolderName}" bleibt unverändert.
              </div>

              <div style={styles.alert('info')}>
                <strong>Ersetze:</strong>{' '}
                <code style={{ background: '#fff', padding: '2px 8px', borderRadius: '4px' }}>{selectedText}</code>
              </div>

              <div style={styles.inputGroup}>
                <label style={styles.label}>Ersetzen durch:</label>
                <input
                  type="text"
                  style={styles.input}
                  placeholder="z.B. 2026-02-20 oder neues Datum"
                  value={replaceWith}
                  onChange={(e) => setReplaceWith(e.target.value)}
                />
              </div>

              {/* Vorschau */}
              {replaceWith && files.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <label style={styles.label}>Vorschau:</label>
                  <div style={{ background: '#f0f8ff', borderRadius: '8px', padding: '15px' }}>
                    {files
                      .filter((f) => f.name.includes(selectedText))
                      .slice(0, 5)
                      .map((file, index) => (
                        <div key={index} style={{ marginBottom: '10px', fontSize: '14px' }}>
                          <div style={{ textDecoration: 'line-through', color: '#999' }}>{file.name}</div>
                          <div style={{ color: '#28a745', fontWeight: 500 }}>
                            → {file.name.split(selectedText).join(replaceWith)}
                          </div>
                        </div>
                      ))}
                    {files.filter((f) => f.name.includes(selectedText)).length > 5 && (
                      <div style={{ color: '#666', fontStyle: 'italic' }}>
                        ... und {files.filter((f) => f.name.includes(selectedText)).length - 5} weitere
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button style={styles.button('secondary')} onClick={() => setStep(2)}>
                  ← Zurück
                </button>
                <button
                  style={styles.button('success', loading || !replaceWith)}
                  onClick={handleRename}
                  disabled={loading || !replaceWith}
                >
                  {loading && <span style={styles.spinner} />}
                  {loading ? 'Wird umbenannt...' : '✅ Jetzt umbenennen'}
                </button>
                <button style={styles.button('secondary')} onClick={handleReset}>
                  🔄 Neu starten
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
