import 'dotenv/config'

import { createClient } from '@supabase/supabase-js'

import {
  approveUserEmail,
  ensureSchema,
  listApprovedUsers,
  pool,
  revokeApprovedUserEmail,
} from './db.mjs'

const [, , command, email, ...rest] = process.argv

try {
  await ensureSchema()

  if (command === 'approve') {
    await approve(email, rest)
  } else if (command === 'revoke') {
    await revoke(email)
  } else if (command === 'list') {
    await list()
  } else {
    printHelp()
    process.exitCode = 1
  }
} finally {
  await pool.end()
}

async function approve(email, args) {
  if (!email) {
    throw new Error('Pass an email to approve.')
  }

  const options = parseOptions(args)
  const approvedUser = await approveUserEmail(email, {
    approvedBy: options.by ?? 'cli',
    displayName: options.name,
    notes: options.notes,
  })

  if (!approvedUser) {
    throw new Error(`Could not approve ${email}. Check that it is a valid email address.`)
  }

  console.log(`Approved ${approvedUser.email}`)

  if (options.invite) {
    await sendSupabaseInvite(approvedUser.email, options)
  }
}

async function revoke(email) {
  if (!email) {
    throw new Error('Pass an email to revoke.')
  }

  const revokedUser = await revokeApprovedUserEmail(email)

  if (!revokedUser) {
    throw new Error(`No approved user found for ${email}.`)
  }

  console.log(`Revoked ${revokedUser.email}`)
}

async function list() {
  const users = await listApprovedUsers()

  if (users.length === 0) {
    console.log('No approved users yet.')
    return
  }

  for (const user of users) {
    const status = user.revokedAt ? 'revoked' : 'active'
    const displayName = user.displayName ? ` (${user.displayName})` : ''
    console.log(`${status.padEnd(7)} ${user.email}${displayName}`)
  }
}

function parseOptions(args) {
  const options = {}

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === '--by') {
      options.by = args[index + 1]
      index += 1
    } else if (arg === '--invite') {
      options.invite = true
    } else if (arg === '--name') {
      options.name = args[index + 1]
      index += 1
    } else if (arg === '--notes') {
      options.notes = args[index + 1]
      index += 1
    } else if (arg === '--redirect-to') {
      options.redirectTo = args[index + 1]
      index += 1
    }
  }

  return options
}

async function sendSupabaseInvite(email, options) {
  const supabaseUrl = String(process.env.SUPABASE_URL ?? '').trim()
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before using --invite.')
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const { error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: getInviteRedirectUrl(options),
  })

  if (error) {
    throw new Error(`Supabase invite failed: ${error.message}`)
  }

  console.log(`Invite sent to ${email}`)
}

function getInviteRedirectUrl(options) {
  return (
    normalizeUrl(options.redirectTo) ??
    normalizeUrl(process.env.AUTH_INVITE_REDIRECT_URL) ??
    normalizeUrl(process.env.APP_URL) ??
    'http://localhost:5173'
  )
}

function normalizeUrl(value) {
  const url = String(value ?? '').trim()

  return url ? url : null
}

function printHelp() {
  console.log(`
Usage:
  npm run auth:approve -- user@example.com [--invite] [--name "Name"] [--notes "Waitlist note"] [--by admin]
  npm run auth:revoke -- user@example.com
  npm run auth:list
`)
}
