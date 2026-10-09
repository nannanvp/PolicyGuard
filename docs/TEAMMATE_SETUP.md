# Run PolicyGuard on another Windows laptop

## What to send your teammate

Send **SETUP_POLICYGUARD.bat**. It is a self-contained Windows installer/launcher available at:

https://raw.githubusercontent.com/nannanvp/PolicyGuard/main/SETUP_POLICYGUARD.bat

On GitHub, open `SETUP_POLICYGUARD.bat` and use **Download raw file**. If the browser displays its text, save that raw text with the exact filename `SETUP_POLICYGUARD.bat`, not `.bat.txt` or an HTML page. Double-click it. A normal Windows PowerShell process handles setup; the file does not change the machine's permanent PowerShell execution policy.

## First run

1. Download a snapshot of `nannanvp/PolicyGuard` at a recorded Git commit. No Git installation or GitHub sign-in is needed.
2. Download the current Windows Node.js **24.x** portable runtime from `nodejs.org`. Check its SHA-256 hash against Node's published checksum before running it. Windows x64 and ARM64 downloads are selected according to the operating-system architecture.
3. Install the precise dependencies in `package-lock.json` with `npm ci`. Node and npm live inside this installation; system-wide Node and PATH settings are not changed.
4. Initialise two persistent Ethereum chains, an administrator, two employed agents, two customers and three policies. Passwords and blockchain signing keys are newly generated on this laptop.
5. Create desktop shortcuts and open the website in the default browser after the server is ready.

Allow several minutes for the downloads and first compilation/deployment. Keep the setup window open. The application normally opens at **http://127.0.0.1:3000**. If that port belongs to another application, the launcher selects another available port and opens the correct address. Opening the launcher twice reuses this installation's already-running website.

## Future runs

Double-click the **PolicyGuard** desktop shortcut. Keep its server window open while using the site; press **Ctrl+C** to stop. Internet is not required after the first successful setup. Restarting preserves accounts, policies, notifications, assignments and both chain histories.

The sample accounts are:

| Role | Username | Starting records |
|---|---|---|
| Customer | `sample_krishnan` | Growth and Assurance |
| Customer | `sample_meera` | Long-Term |
| Agent | `sample_ananya` | Krishnan's original agent |
| Agent | `sample_vikram` | Meera's original agent |
| Administrator | `admin` | Approvals and synchronisation |

The **PolicyGuard Login Details** shortcut opens sample passwords. The administrator password is in `INITIAL_ADMIN.txt` beside that file. These files are private to the laptop and are never uploaded to GitHub.

## Files on the laptop

```text
%LOCALAPPDATA%\PolicyGuard\
  Start PolicyGuard.bat      Future-launch entry point
  app\                      Downloaded source and installed dependencies
    data\                   SQLite, secret.key and both Ethereum chain databases
      INITIAL_ADMIN.txt     Private administrator login
      SAMPLE_ACCOUNTS.txt   Private fictional-account logins
  runtime\                  Private Node.js and npm
  downloads\                Downloaded setup archives
  source.json               Installed Git commit
  runtime.json              Runtime location and download checksum
```

Paste `%LOCALAPPDATA%\PolicyGuard` into File Explorer's address bar to find the folder. If creating shortcuts is blocked by your desktop settings, open `Start PolicyGuard.bat` in that folder directly.

This is **the same application with separate local data**, not a shared online database. Changes made by one teammate will not appear on the other's laptop. Use separate browser profiles or an incognito window when showing different account roles on one laptop.

## Reruns, updates and recovery

Rerunning `SETUP_POLICYGUARD.bat` reuses a recognised installation, skips completed dependencies and preserves data. It does not auto-update application or Solidity source because deployed contract history is tied to that source version. For development, use a normal Git checkout separately; plan any later contract migration explicitly.

If a network download or dependency installation fails, restore the connection and rerun the setup. If initial blockchain setup was interrupted and startup reports incomplete storage, do not delete individual database or key files. Keep the entire installation and inspect the recovery message. A backup must include the complete `app/data` directory, copied while the application is stopped, together with its matching source revision.

For a deliberately separate clean installation, choose a different folder explicitly using the `POLICYGUARD_INSTALL_ROOT` environment variable before running setup. This does not overwrite the original installation. An unrecognised existing `app` folder is never replaced automatically.

## Requirements and troubleshooting

- Windows 10/11 on x64 or ARM64. The end-to-end automated setup run is verified on Windows x64; ARM64 uses Node's official ARM64 archive but was not run on ARM hardware during this delivery.
- Internet access to `github.com`, `api.github.com`, `codeload.github.com`, `nodejs.org` and `registry.npmjs.org` for first setup. A school/company network may block one of these services.
- If Windows or a managed-device policy blocks running downloaded scripts, consult that device's administrator. The installer does not disable security software or require an elevated account.
- The Ganache µWS fallback notice is informational. The local Ethereum chains use the JavaScript fallback with Node 24.
- If a user already has their own profiles in `data`, they are preserved; setup does not overwrite them with sample accounts.

## Validation controls for maintainers

These are optional environment variables, not steps your teammate needs:

| Variable | Effect |
|---|---|
| `POLICYGUARD_INSTALL_ROOT` | Use a separate explicit installation folder |
| `POLICYGUARD_SETUP_NO_LAUNCH=1` | Finish setup without leaving a server running |
| `POLICYGUARD_SETUP_NO_PAUSE=1` | Skip the final batch-file keypress |
| `POLICYGUARD_SETUP_NO_SHORTCUTS=1` | Skip desktop shortcuts during automated tests |
| `POLICYGUARD_NO_BROWSER=1` | Test the local launcher without opening a browser |

The ordinary double-click path creates shortcuts and opens the browser.
