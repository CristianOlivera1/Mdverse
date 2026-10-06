/**
 * Row level security checks against a real Supabase project.
 *
 *   pnpm db:rls
 *
 * Why a script and not a unit test: RLS is enforced by Postgres, so the only
 * honest way to test it is to reach the project with several identities and watch
 * what each of them can actually do. The suite therefore creates two throwaway
 * accounts (confirmed, never emailed), acts as each one through the Data API —
 * exactly the path a browser takes — and deletes them when it finishes.
 *
 * It needs the keys already in `.env`:
 *   PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY (anon role),
 *   SUPABASE_SECRET_KEY (admin API: create/delete the test users).
 * No database password and no CLI are involved.
 *
 * What it cannot cover: a *token* holder reading an `unlisted` document, because
 * that resolution is deliberately server-side (phase 5) and never goes through
 * the Data API with the token.
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import process from 'node:process';

const REQUIRED_TABLES = [
  'profiles',
  'documents',
  'document_collaborators',
  'document_invitations',
  'document_versions',
  'comments',
  'share_links',
];

function readEnv() {
  const env = {};
  let raw;
  try {
    raw = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
  } catch {
    throw new Error('Missing .env — copy .env.example and fill in the Supabase keys.');
  }

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at < 0) continue;
    env[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }

  const missing = [
    'PUBLIC_SUPABASE_URL',
    'PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SECRET_KEY',
  ].filter((key) => !env[key] || /YOUR_|^x\.x\.x$/i.test(env[key]));

  if (missing.length > 0) {
    throw new Error(`Missing or placeholder values in .env: ${missing.join(', ')}`);
  }

  env.PUBLIC_SUPABASE_URL = env.PUBLIC_SUPABASE_URL.replace(/\/+$/, '');
  return env;
}

/** Minimal Data API client, one per identity. */
function createClient({ url, apiKey, accessToken }) {
  const headers = {
    apikey: apiKey,
    Authorization: `Bearer ${accessToken ?? apiKey}`,
    'Content-Type': 'application/json',
  };

  return {
    async rest(path, init = {}) {
      const response = await fetch(`${url}/rest/v1/${path}`, {
        ...init,
        headers: { ...headers, ...init.headers },
      });
      const text = await response.text();
      let body;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        // A non-JSON error page (proxy, gateway) is still worth reporting.
        body = text;
      }
      return { status: response.status, body };
    },
    async auth(path, body) {
      const response = await fetch(`${url}/auth/v1/${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
    async admin(path, init = {}) {
      const response = await fetch(`${url}/auth/v1/admin/${path}`, {
        ...init,
        headers: { ...headers, ...init.headers },
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
  };
}

const results = [];

function check(label, condition, detail = '') {
  results.push({ label, ok: Boolean(condition), detail });
  const mark = condition ? '\u001b[32mPASS\u001b[0m' : '\u001b[31mFAIL\u001b[0m';
  console.log(`  ${mark}  ${label}${detail && !condition ? `\n         ${detail}` : ''}`);
}

async function main() {
  const env = readEnv();
  const url = env.PUBLIC_SUPABASE_URL;
  const anonKey = env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secretKey = env.SUPABASE_SECRET_KEY;
  const admin = createClient({ url, apiKey: secretKey });

  console.log(`\nSupabase RLS checks → ${url}\n`);

  // 1. Schema must exist, otherwise every assertion below is meaningless.
  console.log('schema');
  const present = [];
  for (const table of REQUIRED_TABLES) {
    const { status, body } = await admin.rest(`${table}?select=*&limit=1`);
    if (status >= 400) {
      const code = body && typeof body === 'object' ? body.code : '';
      present.push({ table, ok: false, code });
    } else {
      present.push({ table, ok: true });
    }
  }
  const missing = present.filter((entry) => !entry.ok);
  check(
    `required tables exist (${REQUIRED_TABLES.length})`,
    missing.length === 0,
    missing.length > 0
      ? `Missing: ${missing.map((entry) => `${entry.table} [${entry.code}]`).join(', ')}\n         Apply the migrations in supabase/migrations/ first (SQL Editor or pnpm db:push).`
      : '',
  );
  if (missing.length > 0) return false;

  const runId = randomUUID().slice(0, 8);
  const password = `rls-check-${randomUUID().slice(0, 12)}`;
  const created = [];

  try {
    // 2. Two accounts. `email_confirm` keeps GoTrue from sending anything, and the
    //    signup triggers are the chance to verify the profile row and username.
    console.log('\naccounts (signup triggers)');
    const accounts = [];
    for (const index of [1, 2]) {
      const email = `rls-check-${runId}-${index}@example.com`;
      const { status, body } = await admin.admin('users', {
        method: 'POST',
        body: JSON.stringify({ email, password, email_confirm: true }),
      });
      if (status >= 400)
        throw new Error(`could not create ${email}: ${status} ${JSON.stringify(body)}`);
      created.push(body);
      accounts.push({ email, id: body.id });
    }

    // Signing in with the password is what a browser does, and it is what turns
    // each account into an `authenticated` role for the Data API.
    for (const account of accounts) {
      const client = createClient({ url, apiKey: anonKey });
      const { status, body } = await client.auth('token?grant_type=password', {
        email: account.email,
        password,
      });
      if (status >= 400)
        throw new Error(`could not sign in ${account.email}: ${JSON.stringify(body)}`);
      account.token = body.access_token;
      account.client = createClient({ url, apiKey: anonKey, accessToken: account.token });
    }

    const [owner, stranger] = accounts;

    for (const account of accounts) {
      const { body } = await account.client.rest(`profiles?select=id,username&id=eq.${account.id}`);
      check(
        `profile row created for ${account.email.split('@')[0]}`,
        Array.isArray(body) && body.length === 1 && typeof body[0].username === 'string',
        JSON.stringify(body),
      );
    }

    // 3. Owner creates a document; the slug is generated by the database.
    console.log('\ndocuments');
    const { status: insertStatus, body: inserted } = await owner.client.rest('documents', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ owner_id: owner.id, title: 'RLS check', content: '# Private\n' }),
    });
    const document = Array.isArray(inserted) ? inserted[0] : null;
    check(
      'owner can insert a document',
      insertStatus < 300 && document && document.owner_id === owner.id,
      `${insertStatus} ${JSON.stringify(inserted)}`,
    );
    check(
      'slug generated from the title',
      document?.slug === 'rls-check',
      `slug = ${document?.slug}`,
    );
    check(
      'new documents are private and revision 1',
      document?.visibility === 'private' && document?.revision === 1,
    );

    const readBack = await stranger.client.rest(`documents?select=id&id=eq.${document.id}`);
    check(
      'a stranger cannot read it',
      Array.isArray(readBack.body) && readBack.body.length === 0,
      JSON.stringify(readBack.body),
    );

    const strangerWrite = await stranger.client.rest(`documents?id=eq.${document.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ title: 'Stolen' }),
    });
    check(
      'a stranger cannot update it',
      Array.isArray(strangerWrite.body) && strangerWrite.body.length === 0,
      `${strangerWrite.status} ${JSON.stringify(strangerWrite.body)}`,
    );

    const forgedInsert = await stranger.client.rest('documents', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ owner_id: owner.id, title: 'Forged' }),
    });
    check(
      'nobody can create a document owned by someone else',
      forgedInsert.status >= 400,
      `${forgedInsert.status} ${JSON.stringify(forgedInsert.body)}`,
    );

    const steal = await owner.client.rest(`documents?id=eq.${document.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ owner_id: stranger.id }),
    });
    check(
      'owner_id cannot be reassigned',
      Array.isArray(steal.body) && (steal.body.length === 0 || steal.body[0].owner_id === owner.id),
      `${steal.status} ${JSON.stringify(steal.body)}`,
    );

    // 4. Collaboration: editor can write, reader cannot.
    console.log('\ncollaboration');
    const invite = await owner.client.rest('document_collaborators', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        document_id: document.id,
        user_id: stranger.id,
        role: 'editor',
        invited_by: owner.id,
      }),
    });
    check(
      'owner can add a collaborator',
      invite.status < 300 && Array.isArray(invite.body) && invite.body.length === 1,
      `${invite.status} ${JSON.stringify(invite.body)}`,
    );

    const asEditor = await stranger.client.rest(`documents?select=id,content&id=eq.${document.id}`);
    check(
      'an editor can read the document',
      Array.isArray(asEditor.body) && asEditor.body.length === 1,
      JSON.stringify(asEditor.body),
    );

    const editResult = await stranger.client.rest(`documents?id=eq.${document.id}&revision=eq.1`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        content: '# Private\n\neditor was here\n',
        last_edited_by: stranger.id,
      }),
    });
    check(
      'an editor can update the content (revision bumped)',
      Array.isArray(editResult.body) &&
        editResult.body.length === 1 &&
        editResult.body[0].revision === 2,
      `${editResult.status} ${JSON.stringify(editResult.body)}`,
    );

    const staleWrite = await owner.client.rest(`documents?id=eq.${document.id}&revision=eq.1`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ content: 'stale write' }),
    });
    check(
      'a stale revision updates nothing (optimistic concurrency)',
      Array.isArray(staleWrite.body) && staleWrite.body.length === 0,
      JSON.stringify(staleWrite.body),
    );

    const versions = await stranger.client.rest(
      `document_versions?select=content,revision&document_id=eq.${document.id}&order=revision.desc`,
    );
    check(
      'the replaced state was snapshotted',
      Array.isArray(versions.body) &&
        versions.body.some((row) => row.revision === 1 && row.content.includes('Private')),
      JSON.stringify(versions.body),
    );

    const downgrade = await owner.client.rest(
      `document_collaborators?document_id=eq.${document.id}&user_id=eq.${stranger.id}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ role: 'reader' }),
      },
    );
    check(
      'owner can downgrade the role',
      Array.isArray(downgrade.body) && downgrade.body.length === 1,
      JSON.stringify(downgrade.body),
    );

    const readerWrite = await stranger.client.rest(`documents?id=eq.${document.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ content: 'reader should not write' }),
    });
    check(
      'a reader can no longer write',
      Array.isArray(readerWrite.body) && readerWrite.body.length === 0,
      `${readerWrite.status} ${JSON.stringify(readerWrite.body)}`,
    );

    // 4b. Invitations: an address with no account yet becomes a collaborator the
    //     moment it signs up, through the trigger on auth.users.
    console.log('\ninvitations');
    const invitedEmail = `rls-check-${runId}-3@example.com`;

    const inviteInsert = await owner.client.rest('document_invitations', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        document_id: document.id,
        email: invitedEmail,
        role: 'editor',
        invited_by: owner.id,
      }),
    });
    const invitation =
      Array.isArray(inviteInsert.body) && inviteInsert.body.length === 1
        ? inviteInsert.body[0]
        : null;
    check(
      'the owner can invite an address that has no account yet',
      Boolean(invitation && invitation.token),
      `${inviteInsert.status} ${JSON.stringify(inviteInsert.body)}`,
    );

    if (!invitation) {
      check(
        'the invited account can open the document right after signing up',
        false,
        'no invitation row to follow up on',
      );
    } else {
      const invitedAccount = await admin.admin('users', {
        method: 'POST',
        body: JSON.stringify({ email: invitedEmail, password, email_confirm: true }),
      });
      if (invitedAccount.status >= 400) {
        throw new Error(
          `could not create ${invitedEmail}: ${invitedAccount.status} ${JSON.stringify(invitedAccount.body)}`,
        );
      }
      created.push(invitedAccount.body);

      const invitedClient = createClient({ url, apiKey: anonKey });
      const invitedSignIn = await invitedClient.auth('token?grant_type=password', {
        email: invitedEmail,
        password,
      });
      const invited = createClient({
        url,
        apiKey: anonKey,
        accessToken: invitedSignIn.body.access_token,
      });

      const invitedRead = await invited.rest(`documents?select=id&id=eq.${document.id}`);
      check(
        'the invited account can open the document right after signing up',
        Array.isArray(invitedRead.body) && invitedRead.body.length === 1,
        `${invitedRead.status} ${JSON.stringify(invitedRead.body)}`,
      );

      const accepted = await owner.client.rest(
        `document_invitations?select=accepted_at&id=eq.${invitation.id}`,
      );
      check(
        'the invitation is marked as accepted',
        Array.isArray(accepted.body) && Boolean(accepted.body[0] && accepted.body[0].accepted_at),
        JSON.stringify(accepted.body),
      );

      const invitedWrite = await invited.rest(`documents?id=eq.${document.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ content: 'the invited editor wrote this' }),
      });
      check(
        'the invited role grants what the invitation promised (editor)',
        Array.isArray(invitedWrite.body) && invitedWrite.body.length === 1,
        `${invitedWrite.status} ${JSON.stringify(invitedWrite.body)}`,
      );
    }

    const selfPromote = await stranger.client.rest(
      `document_collaborators?document_id=eq.${document.id}&user_id=eq.${stranger.id}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ role: 'admin' }),
      },
    );
    check(
      'a collaborator cannot promote themselves',
      Array.isArray(selfPromote.body) && selfPromote.body.length === 0,
      `${selfPromote.status} ${JSON.stringify(selfPromote.body)}`,
    );

    const linkRead = await stranger.client.rest(
      `share_links?select=token&document_id=eq.${document.id}`,
    );
    check(
      'a collaborator cannot read share tokens',
      Array.isArray(linkRead.body) && linkRead.body.length === 0,
      `${linkRead.status} ${JSON.stringify(linkRead.body)}`,
    );

    const foreignDelete = await stranger.client.rest(`documents?id=eq.${document.id}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    });
    check(
      'only the owner can delete it',
      Array.isArray(foreignDelete.body) && foreignDelete.body.length === 0,
      `${foreignDelete.status} ${JSON.stringify(foreignDelete.body)}`,
    );

    // 5. Anonymous visitors: nothing private, only what was published.
    console.log('\nanonymous');
    const anon = createClient({ url, apiKey: anonKey });
    const anonRead = await anon.rest(`documents?select=id&id=eq.${document.id}`);
    check(
      'an anonymous visitor cannot read a private document',
      Array.isArray(anonRead.body) && anonRead.body.length === 0,
      `${anonRead.status} ${JSON.stringify(anonRead.body)}`,
    );

    const anonInsert = await anon.rest('documents', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ owner_id: owner.id, title: 'anon' }),
    });
    check('an anonymous visitor cannot insert', anonInsert.status >= 400, `${anonInsert.status}`);

    await owner.client.rest(`documents?id=eq.${document.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ visibility: 'public' }),
    });
    const publicRead = await anon.rest(`documents?select=id,title&id=eq.${document.id}`);
    check(
      'an anonymous visitor can read a public document',
      Array.isArray(publicRead.body) && publicRead.body.length === 1,
      JSON.stringify(publicRead.body),
    );

    const publicWrite = await anon.rest(`documents?id=eq.${document.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ content: 'anon write' }),
    });
    check(
      'an anonymous visitor cannot write, even to a public document',
      publicWrite.status >= 400 ||
        (Array.isArray(publicWrite.body) && publicWrite.body.length === 0),
      `${publicWrite.status}`,
    );

    await owner.client.rest(`documents?id=eq.${document.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ visibility: 'private' }),
    });

    // 6. the owner keeps the full picture.
    console.log('\nowner');
    const ownerRead = await owner.client.rest(`documents?select=id,revision&id=eq.${document.id}`);
    check(
      'owner sees the document',
      Array.isArray(ownerRead.body) && ownerRead.body.length === 1,
      JSON.stringify(ownerRead.body),
    );

    const ownerDelete = await owner.client.rest(`documents?id=eq.${document.id}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    });
    check(
      'owner can delete it',
      Array.isArray(ownerDelete.body) && ownerDelete.body.length === 1,
      JSON.stringify(ownerDelete.body),
    );

    const orphanVersions = await owner.client.rest(
      `document_versions?select=id&document_id=eq.${document.id}`,
    );
    check(
      'deleting the document removes its history (cascade)',
      Array.isArray(orphanVersions.body) && orphanVersions.body.length === 0,
      JSON.stringify(orphanVersions.body),
    );
  } finally {
    // Always clean up: the project belongs to the user, not to this test.
    let removed = 0;
    for (const user of created) {
      const { status } = await admin.admin(`users/${user.id}`, { method: 'DELETE' });
      if (status < 400) removed += 1;
    }
    if (created.length > 0) {
      console.log(
        `\ncleanup: ${removed}/${created.length} test account(s) deleted (documents and profiles cascade)`,
      );
    }
  }

  const failed = results.filter((result) => !result.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed${failed.length > 0 ? ` — FAILED: ${failed.map((f) => f.label).join('; ')}` : ''}\n`,
  );

  return failed.length === 0;
}

main()
  .then((ok) => {
    process.exitCode = ok ? 0 : 1;
  })
  .catch((error) => {
    console.error(`\n${error.message}\n`);
    process.exitCode = 1;
  });
