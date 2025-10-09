

 async function getSidCookie(apiBaseUrl, apiUsername, apiPassword) {
   if (apiUsername && apiPassword) {
     // Authenticate via /api/v2/auth/login to get SID cookie
     const loginFormData = new URLSearchParams();
     loginFormData.append('username', apiUsername);
     loginFormData.append('password', apiPassword);

     const loginResponse = await fetch(`${apiBaseUrl}/api/v2/auth/login`, {
       method: 'POST',
       headers: {
         'Content-Type': 'application/x-www-form-urlencoded',
         'Referer': apiBaseUrl,
         'Origin': apiBaseUrl
       },
       body: loginFormData.toString()
     });

     if (!loginResponse.ok) {
       throw new Error(`Failed to authenticate with qBittorrent: ${loginResponse.status}`);
     }

     // Extract SID cookie from Set-Cookie header (SID or sid)
     const setCookieHeader = loginResponse.headers.get('set-cookie');
     if (setCookieHeader) {
       // Try uppercase SID first (standard qBittorrent)
       let sidMatch = setCookieHeader.match(/SID=([^;]+)/);
       if (sidMatch) {
         return { name: 'SID', value: sidMatch[1] };
       }
       // Try lowercase sid (Decypharr)
       sidMatch = setCookieHeader.match(/sid=([^;]+)/);
       if (sidMatch) {
         return { name: 'sid', value: sidMatch[1] };
       }
     }

     throw new Error('No SID/sid cookie returned from qBittorrent');
   } else {
     throw new Error('No authentication credentials provided');
   }
 }
 
 async function authenticateQBittorrent(apiBaseUrl, username, password) {
  // Test authentication by trying to get SID cookie
  const sidCookie = await getSidCookie(apiBaseUrl, username, password);

  // Test if the SID cookie works by fetching app version
  const testResponse = await fetch(`${apiBaseUrl}/api/v2/app/version`, {
    headers: {
      'Referer': apiBaseUrl,
      'Origin': apiBaseUrl,
      'Cookie': `${sidCookie.name}=${sidCookie.value}`
    }
  });

  if (!testResponse.ok) {
    throw new Error('Authentication failed: Invalid credentials');
  }

  return true;
}

async function generateHMAC(message, key) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const messageData = encoder.encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function verifyCookie(cookieValue, secretKey) {
  if (!cookieValue) return null;

  try {
    const [timestamp, sidData, signature] = cookieValue.split('.');
    if (!timestamp || !sidData || !signature) return null;

    const expectedSignature = await generateHMAC(`${timestamp}.${sidData}`, secretKey);
    if (signature !== expectedSignature) return null;

    const issueTime = parseInt(timestamp);
    const oneYear = 365 * 24 * 60 * 60 * 1000;
    if ((Date.now() - issueTime) >= oneYear) return null;

    // Decode SID data: format is "name:value"
    const decoded = atob(sidData);
    const [name, value] = decoded.split(':', 2);
    return { name, value };
  } catch {
    return null;
  }
}

async function generateAuthCookie(sidCookie, secretKey) {
  const timestamp = Date.now().toString();
  // Encode SID cookie as "name:value" in base64
  const sidData = btoa(`${sidCookie.name}:${sidCookie.value}`);
  const signature = await generateHMAC(`${timestamp}.${sidData}`, secretKey);
  return `${timestamp}.${sidData}.${signature}`;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function getResultPage(result) {
  const isSuccess = result.status === 'success';
  const statusColor = isSuccess ? '#43a047' : '#fb8c00';

  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${isSuccess ? 'Success' : 'Warning'} - qBittorrent Worker</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
    <style>
        article { margin-top: 2rem; }
        .status-badge {
            display: inline-block;
            padding: 0.25rem 0.75rem;
            border-radius: 1rem;
            background: ${statusColor};
            color: white;
            font-weight: 600;
            margin-bottom: 1rem;
        }
        .file-list {
            max-height: 400px;
            overflow-y: auto;
            background: var(--pico-background-color);
            border-radius: var(--pico-border-radius);
            padding: 1rem;
            margin: 0;
        }
        .file-list li {
            padding: 0.5rem;
            border-bottom: 1px solid var(--pico-muted-border-color);
        }
        .file-list li:last-child { border-bottom: none; }
        code {
            font-weight: normal !important;
        }
        .file-list code {
            font-size: 0.875rem;
            vertical-align: baseline;
        }
    </style>
</head>
<body>
    <main class="container">
        <article>
            <header>
                <span class="status-badge">${result.status.toUpperCase().replace(/_/g, ' ')}</span>
                <h2>${result.message}</h2>
            </header>

            ${result.infohash && result.infohash !== 'unknown' ? `
            <p><strong>Infohash:</strong> <code>${result.infohash}</code></p>
            ` : ''}

            ${result.api_error ? `
            <p><mark><strong>API Warning:</strong> ${result.api_error}</mark></p>
            ` : ''}

            ${result.files && result.files.length > 0 ? `
            <ol class="file-list">
                ${result.files.map(file => `
                <li>${file.name} <code>${formatBytes(file.size)}</code></li>
                `).join('')}
            </ol>
            ` : ''}
        </article>
    </main>
</body>
</html>`;
}

 function getHomePage() {
   return `<!DOCTYPE html>
 <html>
 <head>
     <meta charset="UTF-8">
     <title>Add Magnet - qBittorrent Worker</title>
     <meta name="viewport" content="width=device-width, initial-scale=1">
     <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
     <style>
         article { margin-top: 2rem; }
     </style>
 </head>
 <body>
     <main class="container">
         <article>
             <header>
                 <h2>Add Magnet Link</h2>
                 <p>Enter a magnet link or infohash</p>
             </header>

             <form id="addForm">
                 <input type="text" name="magnet" placeholder="magnet:?xt=urn:btih:... or infohash" required autofocus>
                 <button type="submit">Add Torrent</button>
             </form>

             <div id="status"></div>
         </article>
     </main>

     <script>
         document.getElementById('addForm').addEventListener('submit', (e) => {
             e.preventDefault();
             const formData = new FormData(e.target);
             const input = formData.get('magnet').trim();

             if (input) {
                 // Navigate to the magnet link or infohash
                 if (input.startsWith('magnet:')) {
                     window.location.href = '/' + input;
                 } else {
                     window.location.href = '/' + encodeURIComponent(input);
                 }
             }
         });
     </script>
 </body>
 </html>`;
 }

function getAuthPage() {
  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Authenticate - qBittorrent Worker</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
    <style>
        article { margin-top: 2rem; }
    </style>
</head>
<body>
    <main class="container">
        <article>
            <header>
                <h2>Sign In</h2>
                <p>Enter your qBittorrent credentials</p>
            </header>

            <form id="loginForm">
                <input type="text" name="username" placeholder="Username" autocomplete="username" required>
                <input type="password" name="password" placeholder="Password" autocomplete="current-password" required>
                <button type="submit">Sign In</button>
            </form>

            <div id="status"></div>
        </article>
    </main>

    <script>
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const status = document.getElementById('status');
            const formData = new FormData(e.target);
            const submitBtn = e.target.querySelector('button[type="submit"]');

            submitBtn.ariaBusy = true;
            submitBtn.disabled = true;
            status.innerHTML = '';

            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: formData.get('username'),
                        password: formData.get('password')
                    })
                });

                if (response.ok) {
                    status.innerHTML = '<p style="color: var(--pico-ins-color)">✓ Authentication successful! Redirecting...</p>';
                    setTimeout(() => window.location.href = '/', 1000);
                } else {
                    const error = await response.text();
                    status.innerHTML = '<p style="color: var(--pico-del-color)">✗ ' + error + '</p>';
                }
            } catch (error) {
                status.innerHTML = '<p style="color: var(--pico-del-color)">✗ Error: ' + error.message + '</p>';
            } finally {
                submitBtn.ariaBusy = false;
                submitBtn.disabled = false;
            }
        });
    </script>
</body>
</html>`;
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // Require SECRET_KEY from environment
      const secretKey = env.SECRET_KEY;
      if (!secretKey) {
        return new Response('Server configuration error: SECRET_KEY required', {
          status: 500,
          headers: { 'Content-Type': 'text/plain' }
        });
      }

      // Handle magnet links specially since they contain colons and query params
      let pathSegments;
      let torrentIdentifier = null;

      if (url.pathname.startsWith('/magnet:')) {
        // For magnet links, everything after the first slash is the magnet link
        torrentIdentifier = url.pathname.substring(1) + url.search;
        pathSegments = ['magnet'];
      } else {
        pathSegments = url.pathname.split('/').filter(segment => segment !== '');
        if (pathSegments.length > 0) {
          torrentIdentifier = pathSegments[0];
        }
      }

       // Username/Password authentication
       if (request.method === 'POST' && pathSegments[0] === 'api' && pathSegments[1] === 'login') {
         const requestData = await request.json();
         const apiBaseUrl = env.API_BASE_URL;

         // Require API_BASE_URL
         if (!apiBaseUrl) {
           return new Response('Server configuration error: API_BASE_URL required', {
             status: 500,
             headers: { 'Content-Type': 'text/plain' }
           });
         }

         const providedUsername = requestData.username;
         const providedPassword = requestData.password;

         if (!providedUsername || !providedPassword) {
           return new Response('Username and password required', {
             status: 400,
             headers: { 'Content-Type': 'text/plain' }
           });
         }

         try {
           // Get SID cookie from qBittorrent
           const sidCookie = await getSidCookie(apiBaseUrl, providedUsername, providedPassword);

           // Issue auth cookie with SID embedded
           const authCookie = await generateAuthCookie(sidCookie, secretKey);
           const oneYear = 365 * 24 * 60 * 60;

           return new Response('Authentication successful', {
             status: 200,
             headers: {
               'Set-Cookie': `auth=${authCookie}; HttpOnly; Secure; SameSite=Strict; Max-Age=${oneYear}; Path=/`
             }
           });
         } catch (error) {
           return new Response('Failed to verify credentials: ' + error.message, {
             status: 401,
             headers: { 'Content-Type': 'text/plain' }
           });
         }
       }

       // Handle logout
       if (pathSegments[0] === 'logout') {
         return new Response('Redirecting...', {
           status: 302,
           headers: {
             'Location': `${url.origin}/`,
             'Set-Cookie': `auth=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/`
           }
         });
       }

       // Check if env vars are set for qBittorrent auth
       const apiBaseUrl = env.API_BASE_URL;
       let apiUsername = env.API_USERNAME;
       let apiPassword = env.API_PASSWORD;

       const hasQbAuth = apiBaseUrl && apiUsername && apiPassword;

       // Show auth page
       if (pathSegments[0] === 'auth') {
         return new Response(getAuthPage(), {
           headers: { 'Content-Type': 'text/html' }
         });
       }

       // Check authentication for all other requests (skip if qBittorrent auth is configured)
       if (!hasQbAuth) {
         const cookies = request.headers.get('Cookie');
         const authCookie = cookies?.split(';')
           .find(c => c.trim().startsWith('auth='))
           ?.split('=')[1];

         const sidCookie = await verifyCookie(authCookie, secretKey);
         if (!sidCookie) {
           return Response.redirect(`${url.origin}/auth`, 302);
         }
       }

       // Show home page at root if authenticated
       if (pathSegments.length === 0) {
         if (hasQbAuth) {
           // qBittorrent auth is configured, no need for web auth
           return new Response(getHomePage(), {
             headers: { 'Content-Type': 'text/html' }
           });
         } else {
           // Get SID from auth cookie
           const cookies = request.headers.get('Cookie');
           const authCookie = cookies?.split(';')
             .find(c => c.trim().startsWith('auth='))
             ?.split('=')[1];

           const sidCookie = await verifyCookie(authCookie, secretKey);
           if (sidCookie && apiBaseUrl) {
             try {
               // Test if the SID cookie is functional
               const testResponse = await fetch(`${apiBaseUrl}/api/v2/app/version`, {
                 headers: {
                   'Referer': apiBaseUrl,
                   'Origin': apiBaseUrl,
                   'Cookie': `${sidCookie.name}=${sidCookie.value}`
                 }
               });
               if (!testResponse.ok) {
                 // SID not functional, redirect to auth
                 return Response.redirect(`${url.origin}/auth`, 302);
               }
             } catch (error) {
               // Authentication failed, redirect to auth
               return Response.redirect(`${url.origin}/auth`, 302);
             }
           }

           return new Response(getHomePage(), {
             headers: { 'Content-Type': 'text/html' }
           });
         }
       }

      // Main torrent functionality
      // Handle URL-encoded magnet links
      if (!torrentIdentifier && pathSegments.length > 0) {
        torrentIdentifier = decodeURIComponent(pathSegments[0]);
      }

      // Get SID cookie from either env credentials or auth cookie
      let sidCookie;
      if (apiUsername && apiPassword) {
        // Use credentials from environment variables
        try {
          sidCookie = await getSidCookie(apiBaseUrl, apiUsername, apiPassword);
        } catch (error) {
          return new Response(error.message, {
            status: 500,
            headers: { 'Content-Type': 'text/plain' }
          });
        }
      } else {
        // Get SID from auth cookie
        const cookies = request.headers.get('Cookie');
        const authCookie = cookies?.split(';')
          .find(c => c.trim().startsWith('auth='))
          ?.split('=')[1];

        sidCookie = await verifyCookie(authCookie, secretKey);
        if (!sidCookie) {
          return new Response('Authentication required', {
            status: 401,
            headers: { 'Content-Type': 'text/plain' }
          });
        }
      }

      let magnetUrl;
      if (torrentIdentifier.startsWith('magnet:')) {
        // Already a magnet link - use as is
        magnetUrl = torrentIdentifier;
      } else if (torrentIdentifier.includes('magnet%3A')) {
        // URL-encoded magnet link - decode it
        magnetUrl = decodeURIComponent(torrentIdentifier);
      } else {
        // Just an infohash - construct magnet link
        magnetUrl = `magnet:?xt=urn:btih:${torrentIdentifier}`;
      }

       const torrentFormData = new FormData();
       torrentFormData.append('urls', magnetUrl);

       // Build headers with SID cookie (use correct case)
       const headers = {
         'Referer': apiBaseUrl,
         'Origin': apiBaseUrl,
         'Cookie': `${sidCookie.name}=${sidCookie.value}`
       };

      const addTorrentResponse = await fetch(`${apiBaseUrl}/api/v2/torrents/add`, {
        method: 'POST',
        headers: headers,
        body: torrentFormData
      });

      // Note: Some qBittorrent implementations (like Decypharr) may return 500 but still add the torrent
      // We'll continue even on error to try fetching the file list
      const addSuccess = addTorrentResponse.ok;
      let addErrorMessage = null;

      if (!addSuccess) {
        const errorText = await addTorrentResponse.text();
        addErrorMessage = `API returned ${addTorrentResponse.status}: ${errorText || 'No error details'}`;
      }

      // Extract infohash from magnet link or torrent identifier
      let infohash = '';
      if (torrentIdentifier.startsWith('magnet:')) {
        // Extract from magnet link - look for btih parameter
        const btihMatch = magnetUrl.match(/urn:btih:([a-fA-F0-9]{40}|[a-zA-Z0-9]{32})/i);
        if (btihMatch) {
          infohash = btihMatch[1].toLowerCase();
        }
      } else if (torrentIdentifier.match(/^[a-fA-F0-9]{40}$/)) {
        // Already a 40-character hex infohash
        infohash = torrentIdentifier.toLowerCase();
      }

      // Fetch torrent files if we have an infohash
      let files = [];
      if (infohash) {
        try {
          // Wait a moment for the torrent to be added to qBittorrent
          await new Promise(resolve => setTimeout(resolve, 1000));

          const filesResponse = await fetch(`${apiBaseUrl}/api/v2/torrents/files?hash=${infohash}`, {
            headers: headers
          });

          if (filesResponse.ok) {
            files = await filesResponse.json();
          }
        } catch (error) {
          // Non-fatal error - just continue without file list
          console.error('Failed to fetch torrent files:', error);
        }
      }

      // Return result page with torrent info and files
      const result = {
        status: addSuccess ? 'success' : 'partial_success',
        message: addSuccess ? 'Magnet added successfully' : 'Magnet add request completed with warnings',
        infohash: infohash || 'unknown',
        api_error: addErrorMessage,
        files: files.map(f => ({
          name: f.name,
          size: f.size,
          progress: f.progress
        }))
      };

       return new Response(getResultPage(result), {
         status: addSuccess ? 200 : 207, // 207 Multi-Status for partial success
         headers: { 'Content-Type': 'text/html' }
       });
   } catch (error) {
      return new Response(`Error: ${error.message}`, {
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
  },
};