// =====================================================
// GOOGLE APPS SCRIPT - Ordner Kopieren & Umbenennen (Async-fähig)
// =====================================================
// Features:
// - getFolderInfo: liest Ordnernamen + Backup-Vorschlag
// - copyFolderStart: startet Kopier-Job (async, ohne Web-App Timeout)
// - copyFolderStatus: Job-Status/Progress abfragen
// - listFiles: Dateien (rekursiv) im Alt-Ordner lesen
// - renameFiles: Dateien (rekursiv) im Alt-Ordner umbenennen
//
// WICHTIG:
// - Web-App Deployment: "Execute as: Me" + Zugriff passend setzen
// - Script braucht Drive-Berechtigungen.
// - Für große Ordner: Job läuft in kleinen Schritten weiter (bei jedem Status-Poll).

const CONFIG = {
  PARENT_FOLDER_ID: '1mKeo-zXSb6l5rk5APFjosSWxLX5niXdM',
}

const JOBS_KEY = 'copyJobs.pending'
const JOB_PREFIX = 'copyJob:'

// Wie viel Arbeit pro Status-Poll? (klein halten, damit Web-App/Proxy nicht timeouten)
// Hinweis: Für sehr große Ordner lieber kleinere Werte, damit einzelne Requests nicht in Timeouts laufen.
const STATUS_RUN_BUDGET_MS = 1500
const STATUS_MAX_FILE_COPIES = 4
const STATUS_MAX_SUBFOLDERS = 2

// Für große Ordner kann auch das Dateilisten rekursiv lange dauern.
// Deshalb ebenfalls chunked (Job + Polling), ohne Trigger.
const LIST_RUN_BUDGET_MS = 2000
const LIST_MAX_FILES_PER_RUN = 120
const LIST_MAX_FOLDERS_PER_RUN = 30

function doGet() {
  return jsonResponse({ status: 'ok', message: 'Ordner-Workflow API aktiv' })
}

function doPost(e) {
  try {
    const data = parseRequest_(e)
    const action = data.action

    switch (action) {
      case 'getFolderInfo':
        return jsonResponse(getFolderInfoAction_(data.sourceUrl))

      case 'copyFolderStart':
        return jsonResponse(
          copyFolderStartAction_(data.sourceUrl, data.newFolderName, String(data.placeNextToSource) === 'true')
        )

      case 'copyFolderStatus':
        return jsonResponse(copyFolderStatusAction_(data.jobId))

      case 'copyFolder':
        // legacy sync mode (nur lokal empfohlen)
        return jsonResponse(copyFolderActionSync_(data.sourceUrl, data.newFolderName))

      case 'listFiles':
        return jsonResponse(listFilesAction_(data.folderId))

      case 'listFilesStart':
        return jsonResponse(listFilesStartAction_(data.folderId))

      case 'listFilesStatus':
        return jsonResponse(listFilesStatusAction_(data.jobId))

      case 'renameFiles':
        return jsonResponse(renameFilesAction_(data.folderId, data.searchPattern, data.replacePattern))

      default:
        return jsonResponse({ success: false, message: 'Unbekannte Aktion: ' + action })
    }
  } catch (error) {
    return jsonResponse({ success: false, message: String(error) })
  }
}

function resolveBackupParentFolder_(sourceFolderId, placeNextToSource) {
  if (placeNextToSource) {
    try {
      const sourceFolder = DriveApp.getFolderById(sourceFolderId)
      const parents = sourceFolder.getParents()
      if (parents && parents.hasNext()) return parents.next()
    } catch (_) {
      // fall back to configured parent
    }
  }
  return DriveApp.getFolderById(CONFIG.PARENT_FOLDER_ID)
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)
}

function parseRequest_(e) {
  if (e && e.parameter && Object.keys(e.parameter).length > 0) return e.parameter
  if (e && e.postData && e.postData.contents) {
    try {
      return JSON.parse(e.postData.contents)
    } catch (_) {
      return e.parameter || {}
    }
  }
  return {}
}

function extractIdFromUrl_(url) {
  if (!url) return null
  const patterns = [
    /\/folders\/([a-zA-Z0-9-_]+)/,
    /\/file\/d\/([a-zA-Z0-9-_]+)/,
    /id=([a-zA-Z0-9-_]+)/,
    /^([a-zA-Z0-9-_]{25,})$/,
  ]
  for (var i = 0; i < patterns.length; i++) {
    const match = String(url).match(patterns[i])
    if (match) return match[1] || match[0]
  }
  if (String(url).length >= 25 && /^[a-zA-Z0-9-_]+$/.test(String(url))) return String(url)
  return null
}

function suggestBackupName_(folderName) {
  const m = String(folderName || '').match(/(20[2-3][0-9])/)
  if (m) {
    const currentYear = parseInt(m[1], 10)
    return String(folderName).replace(m[1], String(currentYear - 1))
  }
  return String(folderName || '') + '_Backup'
}

function getFolderInfoAction_(sourceUrl) {
  try {
    if (!sourceUrl) return { success: false, message: 'URL ist erforderlich' }
    const folderId = extractIdFromUrl_(sourceUrl)
    if (!folderId) return { success: false, message: 'Ungültige Google Drive URL' }

    const folder = DriveApp.getFolderById(folderId)
    const folderName = folder.getName()

    return {
      success: true,
      folderId: folderId,
      folderName: folderName,
      suggestedBackupName: suggestBackupName_(folderName),
    }
  } catch (err) {
    return { success: false, message: String(err) }
  }
}

// -----------------------------------------------------
// ASYNC COPY JOB
// -----------------------------------------------------

function copyFolderStartAction_(sourceUrl, newFolderName) {
  try {
    if (!sourceUrl || !newFolderName) {
      return { success: false, message: 'URL und Ordnername sind erforderlich' }
    }

    const sourceFolderId = extractIdFromUrl_(sourceUrl)
    if (!sourceFolderId) return { success: false, message: 'Ungültige Google Drive URL' }

    const placeNextToSource = arguments.length >= 3 ? Boolean(arguments[2]) : false
    const parentFolder = resolveBackupParentFolder_(sourceFolderId, placeNextToSource)
    const targetFolder = parentFolder.createFolder(String(newFolderName))

    const jobId = Utilities.getUuid()

    const job = {
      jobId: jobId,
      status: 'running',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceFolderId: sourceFolderId,
      targetFolderId: targetFolder.getId(),
      newFolderName: String(newFolderName),
      progress: {
        copiedFiles: 0,
        createdFolders: 1, // root target created
        pendingFolders: 1,
      },
      queue: [
        {
          sourceId: sourceFolderId,
          targetId: targetFolder.getId(),
          initialized: false,
          files: [],
          folders: [],
        },
      ],
      lastError: null,
    }

    saveJob_(job)
    // Kein Trigger: Fortschritt erfolgt in kleinen Chunks bei copyFolderStatus.

    return {
      success: true,
      jobId: jobId,
      sourceFolderId: sourceFolderId,
      folderId: targetFolder.getId(),
      folderName: String(newFolderName),
      folderUrl: targetFolder.getUrl(),
      message: 'Kopier-Job gestartet',
    }
  } catch (err) {
    return { success: false, message: String(err) }
  }
}

function copyFolderStatusAction_(jobId) {
  if (!jobId) return { success: false, message: 'jobId ist erforderlich' }
  const job = loadJob_(jobId)
  if (!job) return { success: false, message: 'Job nicht gefunden' }

  // Bei jedem Poll einen kleinen Arbeits-Chunk ausführen.
  if (job.status === 'running') {
    const lock = LockService.getScriptLock()
    // Wichtig: nie lange auf Lock warten, sonst laufen Netlify/Browser in Timeouts.
    if (lock.tryLock(200)) {
      try {
        processCopyJobChunk_(job, STATUS_RUN_BUDGET_MS, STATUS_MAX_FILE_COPIES, STATUS_MAX_SUBFOLDERS)
        saveJob_(job)
      } finally {
        lock.releaseLock()
      }
    }
  }

  return {
    success: true,
    jobId: job.jobId,
    status: job.status,
    message: job.lastError || null,
    sourceFolderId: job.sourceFolderId,
    folderId: job.targetFolderId,
    newFolderName: job.newFolderName,
    progress: job.progress,
  }
}

// -----------------------------------------------------
// ASYNC LIST FILES (Job + Polling, liefert Chunks)
// -----------------------------------------------------

function listFilesStartAction_(folderId) {
  try {
    if (!folderId) return { success: false, message: 'Ordner-ID erforderlich' }
    const root = DriveApp.getFolderById(folderId)

    const jobId = Utilities.getUuid()
    const job = {
      jobId: jobId,
      type: 'listFiles',
      status: 'running',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      rootFolderId: folderId,
      folderName: root.getName(),
      lastError: null,
      progress: {
        scannedFolders: 0,
        foundFiles: 0,
        pendingFolders: 1,
      },
      queue: [
        {
          folderId: folderId,
          path: '',
        },
      ],
    }

    saveJob_(job)

    return {
      success: true,
      jobId: jobId,
      status: 'running',
      folderId: folderId,
      folderName: root.getName(),
      progress: job.progress,
      message: 'Dateiliste-Job gestartet',
    }
  } catch (err) {
    return { success: false, message: String(err) }
  }
}

function listFilesStatusAction_(jobId) {
  if (!jobId) return { success: false, message: 'jobId ist erforderlich' }
  const job = loadJob_(jobId)
  if (!job) return { success: false, message: 'Job nicht gefunden' }
  if (job.type !== 'listFiles') return { success: false, message: 'Falscher Job-Typ' }

  var chunk = []

  if (job.status === 'running') {
    const lock = LockService.getScriptLock()
    // Wichtig: nie lange auf Lock warten, sonst laufen Netlify/Browser in Timeouts.
    if (lock.tryLock(200)) {
      try {
        chunk = processListFilesJobChunk_(
          job,
          LIST_RUN_BUDGET_MS,
          LIST_MAX_FILES_PER_RUN,
          LIST_MAX_FOLDERS_PER_RUN
        )
        saveJob_(job)
      } finally {
        lock.releaseLock()
      }
    }
  }

  return {
    success: true,
    jobId: job.jobId,
    status: job.status,
    message: job.lastError || null,
    folderId: job.rootFolderId,
    folderName: job.folderName,
    progress: job.progress,
    files: chunk,
  }
}

function processListFilesJobChunk_(job, budgetMs, maxFiles, maxFolders) {
  const start = Date.now()
  const budgetUntil = start + (budgetMs || 0)

  var out = []
  var foldersScannedThisRun = 0

  while (Date.now() < budgetUntil) {
    if (!job.queue || job.queue.length === 0) {
      job.status = 'done'
      job.progress.pendingFolders = 0
      job.updatedAt = new Date().toISOString()
      return out
    }

    if (foldersScannedThisRun >= maxFolders) break

    const next = job.queue.shift()
    foldersScannedThisRun++

    try {
      const folder = DriveApp.getFolderById(next.folderId)

      const itFiles = folder.getFiles()
      while (itFiles.hasNext()) {
        const f = itFiles.next()
        job.progress.foundFiles++

        out.push({
          id: f.getId(),
          name: f.getName(),
          path: next.path || '',
          mimeType: f.getMimeType(),
          url: f.getUrl(),
        })
      }

      const itFolders = folder.getFolders()
      while (itFolders.hasNext()) {
        const sf = itFolders.next()
        job.queue.push({
          folderId: sf.getId(),
          path: (next.path || '') + sf.getName() + '/',
        })
      }
    } catch (err) {
      job.status = 'error'
      job.lastError = String(err)
      job.updatedAt = new Date().toISOString()
      job.progress.pendingFolders = job.queue ? job.queue.length : 0
      return out
    }

    // Nach jedem Ordner: Progress updaten
    job.progress.scannedFolders++
    job.progress.pendingFolders = job.queue.length
    job.updatedAt = new Date().toISOString()

    // Chunk-Grenze: nur zwischen Ordnern abbrechen (sonst verlieren wir Items).
    if (out.length >= maxFiles) {
      return out
    }
  }

  job.progress.pendingFolders = job.queue ? job.queue.length : 0
  job.updatedAt = new Date().toISOString()
  return out
}

function processCopyJobChunk_(job, budgetMs, maxFileCopies, maxSubfolders) {
  const start = Date.now()
  const budgetUntil = start + (budgetMs || 0)

  let copiedThisRun = 0
  let foldersCreatedThisRun = 0

  while (Date.now() < budgetUntil) {
    if (!job.queue || job.queue.length === 0) {
      job.status = 'done'
      job.progress.pendingFolders = 0
      job.updatedAt = new Date().toISOString()
      return
    }

    const task = job.queue[0]

    if (!task.initialized) {
      const init = initFolderTask_(task.sourceId)
      task.files = init.files
      task.folders = init.folders
      task.initialized = true
      job.progress.pendingFolders = job.queue.length
      job.updatedAt = new Date().toISOString()
      // nach Init raus, damit Poll schnell bleibt
      return
    }

    // 1) Dateien kopieren
    while (task.files.length > 0 && copiedThisRun < maxFileCopies && Date.now() < budgetUntil) {
      const f = task.files.shift()
      try {
        const file = DriveApp.getFileById(f.id)
        const targetFolder = DriveApp.getFolderById(task.targetId)
        file.makeCopy(f.name, targetFolder)
        job.progress.copiedFiles++
        copiedThisRun++
      } catch (err) {
        job.status = 'error'
        job.lastError = String(err)
        job.updatedAt = new Date().toISOString()
        return
      }
    }

    // 2) Unterordner erstellen + Tasks enqueuen
    while (
      task.files.length === 0 &&
      task.folders.length > 0 &&
      foldersCreatedThisRun < maxSubfolders &&
      Date.now() < budgetUntil
    ) {
      const sf = task.folders.shift()
      try {
        const targetFolder = DriveApp.getFolderById(task.targetId)
        const created = targetFolder.createFolder(sf.name)
        job.progress.createdFolders++
        foldersCreatedThisRun++

        job.queue.push({
          sourceId: sf.id,
          targetId: created.getId(),
          initialized: false,
          files: [],
          folders: [],
        })
      } catch (err) {
        job.status = 'error'
        job.lastError = String(err)
        job.updatedAt = new Date().toISOString()
        return
      }
    }

    // 3) Task abgeschlossen?
    if (task.files.length === 0 && task.folders.length === 0) {
      job.queue.shift()
    }

    job.progress.pendingFolders = job.queue.length
    job.updatedAt = new Date().toISOString()

    if (copiedThisRun >= maxFileCopies && foldersCreatedThisRun >= maxSubfolders) {
      return
    }
  }

  job.progress.pendingFolders = job.queue ? job.queue.length : 0
  job.updatedAt = new Date().toISOString()
}

function initFolderTask_(sourceFolderId) {
  const folder = DriveApp.getFolderById(sourceFolderId)

  const files = []
  const itFiles = folder.getFiles()
  while (itFiles.hasNext()) {
    const f = itFiles.next()
    files.push({ id: f.getId(), name: f.getName() })
  }

  const folders = []
  const itFolders = folder.getFolders()
  while (itFolders.hasNext()) {
    const sf = itFolders.next()
    folders.push({ id: sf.getId(), name: sf.getName() })
  }

  return { files: files, folders: folders }
}

function saveJob_(job) {
  PropertiesService.getScriptProperties().setProperty(JOB_PREFIX + job.jobId, JSON.stringify(job))
}

function loadJob_(jobId) {
  const raw = PropertiesService.getScriptProperties().getProperty(JOB_PREFIX + jobId)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch (_) {
    return null
  }
}

function getPendingJobs_() {
  const raw = PropertiesService.getScriptProperties().getProperty(JOBS_KEY)
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch (_) {
    return []
  }
}

function setPendingJobs_(arr) {
  PropertiesService.getScriptProperties().setProperty(JOBS_KEY, JSON.stringify(arr))
}

function enqueueJob_(jobId) {
  const pending = getPendingJobs_()
  if (pending.indexOf(jobId) === -1) pending.push(jobId)
  setPendingJobs_(pending)
}

function dequeueJob_(jobId) {
  const pending = getPendingJobs_().filter(function (id) {
    return id !== jobId
  })
  setPendingJobs_(pending)
}

// -----------------------------------------------------
// LEGACY SYNC COPY (nur lokal empfohlen)
// -----------------------------------------------------

function copyFolderActionSync_(sourceUrl, newFolderName) {
  try {
    if (!sourceUrl || !newFolderName) return { success: false, message: 'URL und Ordnername sind erforderlich' }

    const sourceFolderId = extractIdFromUrl_(sourceUrl)
    if (!sourceFolderId) return { success: false, message: 'Ungültige Google Drive URL' }

    const sourceFolder = DriveApp.getFolderById(sourceFolderId)
    const parentFolder = DriveApp.getFolderById(CONFIG.PARENT_FOLDER_ID)
    const targetFolder = parentFolder.createFolder(String(newFolderName))

    copyFolderRecursive_(sourceFolder, targetFolder)
    const sourceFiles = getFilesFromFolder_(sourceFolder, true)

    return {
      success: true,
      sourceFolderId: sourceFolderId,
      folderId: targetFolder.getId(),
      folderName: String(newFolderName),
      folderUrl: targetFolder.getUrl(),
      sourceFiles: sourceFiles,
      message: 'Backup erstellt',
    }
  } catch (err) {
    return { success: false, message: String(err) }
  }
}

function copyFolderRecursive_(source, target) {
  const files = source.getFiles()
  while (files.hasNext()) {
    const file = files.next()
    file.makeCopy(file.getName(), target)
  }

  const subFolders = source.getFolders()
  while (subFolders.hasNext()) {
    const subFolder = subFolders.next()
    const newSubFolder = target.createFolder(subFolder.getName())
    copyFolderRecursive_(subFolder, newSubFolder)
  }
}

// -----------------------------------------------------
// LIST + RENAME (Alt-Ordner)
// -----------------------------------------------------

function listFilesAction_(folderId) {
  try {
    if (!folderId) return { success: false, message: 'Ordner-ID erforderlich' }
    const folder = DriveApp.getFolderById(folderId)
    return { success: true, files: getFilesFromFolder_(folder, true), folderName: folder.getName() }
  } catch (err) {
    return { success: false, message: String(err) }
  }
}

function renameFilesAction_(folderId, searchPattern, replacePattern) {
  try {
    if (!folderId || !searchPattern) {
      return { success: false, message: 'Ordner-ID und Suchmuster sind erforderlich' }
    }

    const folder = DriveApp.getFolderById(folderId)
    const result = renameFilesInFolder_(folder, String(searchPattern), String(replacePattern || ''), true)
    const files = getFilesFromFolder_(folder, true)

    return {
      success: true,
      renamedCount: result.renamedCount,
      totalFiles: result.totalFiles,
      files: files,
      message: result.renamedCount + ' von ' + result.totalFiles + ' Dateien umbenannt',
    }
  } catch (err) {
    return { success: false, message: String(err) }
  }
}

function getFilesFromFolder_(folder, recursive) {
  const fileList = []

  function processFolder(currentFolder, path) {
    const files = currentFolder.getFiles()
    while (files.hasNext()) {
      const file = files.next()
      fileList.push({
        id: file.getId(),
        name: file.getName(),
        path: path || '',
        mimeType: file.getMimeType(),
        url: file.getUrl(),
      })
    }

    if (recursive) {
      const subFolders = currentFolder.getFolders()
      while (subFolders.hasNext()) {
        const sub = subFolders.next()
        processFolder(sub, (path || '') + sub.getName() + '/')
      }
    }
  }

  processFolder(folder, '')
  return fileList
}

function renameFilesInFolder_(folder, searchPattern, replacePattern, recursive) {
  let renamedCount = 0
  let totalFiles = 0

  function processFolder(currentFolder) {
    const files = currentFolder.getFiles()
    while (files.hasNext()) {
      const file = files.next()
      const oldName = file.getName()
      totalFiles++
      if (oldName.indexOf(searchPattern) !== -1) {
        const newName = oldName.split(searchPattern).join(replacePattern)
        if (newName !== oldName) {
          file.setName(newName)
          renamedCount++
        }
      }
    }

    if (recursive) {
      const subFolders = currentFolder.getFolders()
      while (subFolders.hasNext()) processFolder(subFolders.next())
    }
  }

  processFolder(folder)
  return { renamedCount: renamedCount, totalFiles: totalFiles }
}
