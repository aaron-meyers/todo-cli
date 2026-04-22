import * as msal from "@azure/msal-node";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const SCOPES = ["Tasks.ReadWrite"];

const CLIENT_ID = "47100993-404c-4e79-989b-e2592594fbc6";
const TENANT_ID = "common";

function getCacheDir(): string {
  const dir = path.join(os.homedir(), ".todo-cli");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getCachePath(): string {
  return path.join(getCacheDir(), "token-cache.json");
}

function loadCache(app: msal.PublicClientApplication): void {
  const cachePath = getCachePath();
  if (fs.existsSync(cachePath)) {
    const data = fs.readFileSync(cachePath, "utf-8");
    app.getTokenCache().deserialize(data);
  }
}

function saveCache(app: msal.PublicClientApplication): void {
  const data = app.getTokenCache().serialize();
  fs.writeFileSync(getCachePath(), data, "utf-8");
}

function createApp(): msal.PublicClientApplication {
  const config: msal.Configuration = {
    auth: {
      clientId: CLIENT_ID,
      authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    },
  };
  return new msal.PublicClientApplication(config);
}

/**
 * Acquire an access token for Microsoft Graph, using cached credentials
 * when available and falling back to the device-code flow.
 */
export async function getAccessToken(): Promise<string> {
  const app = createApp();
  loadCache(app);

  // Try silent acquisition first (cached token / refresh token)
  const accounts = await app.getTokenCache().getAllAccounts();
  if (accounts.length > 0) {
    try {
      const result = await app.acquireTokenSilent({
        account: accounts[0],
        scopes: SCOPES,
      });
      if (result?.accessToken) {
        saveCache(app);
        return result.accessToken;
      }
    } catch {
      // Fall through to interactive flow
    }
  }

  // Device-code flow
  const result = await app.acquireTokenByDeviceCode({
    scopes: SCOPES,
    deviceCodeCallback: (response) => {
      console.error(response.message);
    },
  });

  if (!result?.accessToken) {
    throw new Error("Authentication failed – no access token received.");
  }

  saveCache(app);
  return result.accessToken;
}
