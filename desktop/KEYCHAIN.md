# Secrets and the OS keychain

## Where this stands

Secrets are encrypted at rest with AES-256-GCM, with the master key in a `0600`
file next to the database. That is real protection against another user on the
machine and against a stray backup, and it is what ships today.

It is **not** the OS keychain. On macOS the keychain adds:

- the key is protected by the login keychain rather than by file permissions
- it survives a Time Machine restore as a keychain item, not as a loose file
- a copied home directory does not carry a usable key with it

Electron exposes `safeStorage.encryptString` / `decryptString`, backed by
Keychain on macOS, libsecret on Linux and DPAPI on Windows. That is the right
seam, and the shell is where it belongs — the backend has to keep working
headless under `npm run verify`, where no keychain exists.

## The change that is needed

`backend/lib/credentials.js` needs one seam: take the master key from
`STUDIO_MASTER_KEY` when it is set, and fall back to the existing key file when
it is not. `desktop/main.js` then:

1. reads the existing key file once,
2. wraps it with `safeStorage.encryptString`, storing the blob in userData,
3. passes the unwrapped key to the backend as `STUDIO_MASTER_KEY`,
4. deletes the plaintext key file **only after** a secret has been successfully
   decrypted with the keychain-derived key.

Order matters. Step 4 before that proof locks you out of your own tokens, and a
half-finished migration looks exactly like a finished one until the next read.

## Why it is not done here

I could not read `credentials.js` — this environment blocks reading it, by
design, after two live secrets leaked through a helper that looked careful.

Editing the module that holds the encryption logic without seeing it risks
silently breaking decryption of secrets that already exist, including the live
HeyGen MCP tokens in this workspace. That is a confident-looking change with a
failure mode that appears later and reads as data loss.

So: the shell is ready for it, the seam is one named environment variable, and
the migration wants the file open in front of whoever writes it.
