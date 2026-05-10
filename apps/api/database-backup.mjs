import 'dotenv/config'

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const command = process.argv[2]
const args = process.argv.slice(3)

try {
  if (command === 'backup') {
    await backupDatabase()
  } else if (command === 'verify') {
    await verifyBackup()
  } else if (command === 'restore') {
    await restoreDatabase()
  } else {
    printUsage()
    process.exitCode = command ? 1 : 0
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}

async function backupDatabase() {
  const databaseUrl = getRequiredEnv('DATABASE_URL')
  const outputPath = path.resolve(getFlagValue('--out') ?? createDefaultBackupPath())

  await mkdir(path.dirname(outputPath), { recursive: true })
  await runPostgresTool('pg_dump', [
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    '--file',
    outputPath,
    databaseUrl,
  ])

  console.log(`Backup written to ${outputPath}`)
}

async function verifyBackup() {
  const backupPath = getRequiredBackupPath()

  await runPostgresTool('pg_restore', ['--list', backupPath])
  console.log(`Backup archive is readable: ${backupPath}`)
}

async function restoreDatabase() {
  const backupPath = getRequiredBackupPath()
  const targetUrl = getFlagValue('--database-url') ?? process.env.RESTORE_DATABASE_URL

  if (!targetUrl) {
    throw new Error('RESTORE_DATABASE_URL or --database-url is required for restore.')
  }

  if (!hasFlag('--yes')) {
    throw new Error('Restore is destructive. Re-run with --yes after confirming the target database is disposable.')
  }

  if (sameDatabaseUrl(targetUrl, process.env.DATABASE_URL) && !hasFlag('--allow-source-overwrite')) {
    throw new Error(
      'Refusing to restore into DATABASE_URL. Use RESTORE_DATABASE_URL for a fresh test database, or pass --allow-source-overwrite if you truly intend to overwrite the source.',
    )
  }

  await runPostgresTool('pg_restore', [
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-privileges',
    '--dbname',
    targetUrl,
    backupPath,
  ])

  console.log(`Backup restored into the target database from ${backupPath}`)
}

function getRequiredBackupPath() {
  const value = getFlagValue('--file') ?? args.find((arg) => !arg.startsWith('--'))

  if (!value) {
    throw new Error('A backup file path is required. Use --file path/to/backup.dump.')
  }

  const backupPath = path.resolve(value)

  if (!existsSync(backupPath)) {
    throw new Error(`Backup file was not found: ${backupPath}`)
  }

  return backupPath
}

function createDefaultBackupPath() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')

  return path.join('backups', `essence-${timestamp}.dump`)
}

function getFlagValue(name) {
  const index = args.indexOf(name)

  if (index === -1) {
    return null
  }

  const value = args[index + 1]

  return value && !value.startsWith('--') ? value : null
}

function hasFlag(name) {
  return args.includes(name)
}

function getRequiredEnv(name) {
  const value = process.env[name]

  if (!value) {
    throw new Error(`${name} is required.`)
  }

  return value
}

function sameDatabaseUrl(left, right) {
  if (!left || !right) {
    return false
  }

  return normalizeDatabaseUrl(left) === normalizeDatabaseUrl(right)
}

function normalizeDatabaseUrl(value) {
  try {
    const url = new URL(value)
    url.search = ''
    return url.toString()
  } catch {
    return String(value).trim()
  }
}

function runPostgresTool(binary, toolArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, toolArgs, {
      stdio: 'inherit',
      windowsHide: true,
    })

    child.on('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(new Error(`${binary} was not found. Install PostgreSQL client tools and make sure ${binary} is on PATH.`))
        return
      }

      reject(error)
    })

    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`${binary} exited with code ${code}.`))
    })
  })
}

function printUsage() {
  console.log(`Usage:
  npm run db:backup -- [--out backups/essence.dump]
  npm run db:backup:verify -- --file backups/essence.dump
  RESTORE_DATABASE_URL=postgresql://... npm run db:restore -- --file backups/essence.dump --yes

Restore is intended for a fresh test database. It refuses to restore into DATABASE_URL unless --allow-source-overwrite is passed.`)
}
