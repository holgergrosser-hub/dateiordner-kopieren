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
// - Für große Ordner: Job läuft über einen Zeit-Trigger weiter.

const CONFIG = {
  PARENT_FOLDER_ID: '1mKeo-zXSb6l5rk5APFjosSWxLX5niXdM',
}

const JOBS_KEY = 'copyJobs.pending'
const JOB_PREFIX = 'copyJob:'

// Wie viel Arbeit pro Trigger-Lauf?
const RUN_BUDGET_MS = 240000 // ~4 Minuten
const MAX_FILE_COPIES_PER_RUN = 40
const MAX_SUBFOLDERS_PER_RUN = 15

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
        return jsonResponse(copyFolderStartAction_(data.sourceUrl, data.newFolderName))

      case 'copyFolderStatus':
        return jsonResponse(copyFolderStatusAction_(data.jobId))

      case 'copyFolder':
        // legacy sync mode (nur lokal empfohlen)
        return jsonResponse(copyFolderActionSync_(data.sourceUrl, data.newFolderName))

      case 'listFiles':
        return jsonResponse(listFilesAction_(data.folderId))

      case 'renameFiles':
        return jsonResponse(renameFilesAction_(data.folderId, data.searchPattern, data.replacePattern))

      default:
        return jsonResponse({ success: false, message: 'Unbekannte Aktion: ' + action })
    }
  } catch (error) {
    return jsonResponse({ success: false, message: String(error) })
  }
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

    const parentFolder = DriveApp.getFolderById(CONFIG.PARENT_FOLDER_ID)
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
    enqueueJob_(jobId)
    ensureWorkerTrigger_()

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

function ensureWorkerTrigger_() {
  const triggers = ScriptApp.getProjectTriggers()
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processCopyJobs') return
  }

  ScriptApp.newTrigger('processCopyJobs').timeBased().everyMinutes(1).create()
}

function processCopyJobs() {
  const lock = LockService.getScriptLock()
  if (!lock.tryLock(5000)) return

  try {
    const start = Date.now()

    const pending = getPendingJobs_()
    if (pending.length === 0) return

    // Nimm immer den ältesten Job
    const jobId = pending[0]
    const job = loadJob_(jobId)
    if (!job || job.status !== 'running') {
      dequeueJob_(jobId)
      return
    }

    const budgetUntil = start + RUN_BUDGET_MS

    let copiedThisRun = 0
    let foldersCreatedThisRun = 0

    while (Date.now() < budgetUntil) {
      if (!job.queue || job.queue.length === 0) {
        job.status = 'done'
        job.progress.pendingFolders = 0
        job.updatedAt = new Date().toISOString()
        saveJob_(job)
        dequeueJob_(jobId)
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
        saveJob_(job)
        // nach Init raus, damit der Lauf nicht zu lange wird
        return
      }

      // 1) Dateien kopieren
      while (
        task.files.length > 0 &&
        copiedThisRun < MAX_FILE_COPIES_PER_RUN &&
        Date.now() < budgetUntil
      ) {
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
          saveJob_(job)
          dequeueJob_(jobId)
          return
        }
      }

      // 2) Unterordner erstellen + Tasks enqueuen
      while (
        task.files.length === 0 &&
        task.folders.length > 0 &&
        foldersCreatedThisRun < MAX_SUBFOLDERS_PER_RUN &&
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
          saveJob_(job)
          dequeueJob_(jobId)
          return
        }
      }

      // 3) Task abgeschlossen?
      if (task.files.length === 0 && task.folders.length === 0) {
        job.queue.shift()
      }

      job.progress.pendingFolders = job.queue.length
      job.updatedAt = new Date().toISOString()
      saveJob_(job)

      // Wenn wir in diesem Lauf nichts mehr machen dürfen, raus
      if (copiedThisRun >= MAX_FILE_COPIES_PER_RUN && foldersCreatedThisRun >= MAX_SUBFOLDERS_PER_RUN) {
        return
      }
    }

    // Budget erreicht -> speichern
    job.progress.pendingFolders = job.queue.length
    job.updatedAt = new Date().toISOString()
    saveJob_(job)
  } finally {
    lock.releaseLock()
  }
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
