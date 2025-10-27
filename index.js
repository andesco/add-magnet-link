

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
  if (!cookieValue) {
    return null;
  }

  try {
    const [timestamp, sidData, signature] = cookieValue.split('.');

    if (!timestamp || !sidData || !signature) {
      return null;
    }

    const expectedSignature = await generateHMAC(`${timestamp}.${sidData}`, secretKey);
    if (signature !== expectedSignature) {
      return null;
    }

    const issueTime = parseInt(timestamp);
    const oneYear = 365 * 24 * 60 * 60 * 1000;
    const age = Date.now() - issueTime;
    if (age >= oneYear) {
      return null;
    }

    // Decode SID data: format is "name:value"
    const decoded = atob(sidData);
    const [name, value] = decoded.split(':', 2);
    return { name, value };
  } catch (e) {
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
  const statusClass = isSuccess ? 'success' : 'warning';

  return `<!DOCTYPE html>
<html data-theme="light">
<head>
    <meta charset="UTF-8">
    <title>Add Magnet Link: ${isSuccess ? 'Success' : 'Warning'}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
    <link rel="stylesheet" href="/style.css">
    <script>
        // Support light and dark mode based on system preference
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.setAttribute('data-theme', 'dark');
        }
    </script>
</head>
<body>
    <main class="container">
        <article>
            <header>
                <span class="status-badge ${statusClass}">${result.status.toUpperCase().replace(/_/g, ' ')}</span>
                <h2>${result.message}</h2>
            </header>

            ${result.infohash && result.infohash !== 'unknown' ? `
            <p><strong>Infohash:</strong> <code>${result.infohash}</code></p>
            ` : ''}

            ${result.api_error ? `
            <code style="display: block; white-space: pre-wrap; padding: 0.75rem; background: var(--pico-code-background-color); border-radius: var(--pico-border-radius);">${result.api_error}</code>
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
 <html data-theme="light">
 <head>
     <meta charset="UTF-8">
     <title>Add Magnet Link</title>
     <meta name="viewport" content="width=device-width, initial-scale=1">
     <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
     <link rel="stylesheet" href="/style.css">
     <script>
         // Support light and dark mode based on system preference
         if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
             document.documentElement.setAttribute('data-theme', 'dark');
         }
     </script>
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

function getAuthPage(returnPath = '/') {
  return `<!DOCTYPE html>
<html data-theme="light">
<head>
    <meta charset="UTF-8">
    <title>Add Magnet Link: Authenticate</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
    <link rel="stylesheet" href="/style.css">
    <script>
        // Support light and dark mode based on system preference
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.setAttribute('data-theme', 'dark');
        }
    </script>
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
        const returnPath = ${JSON.stringify(returnPath)};

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
                    setTimeout(() => window.location.href = returnPath, 1000);
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

      // Serve style.css
      if (url.pathname === '/style.css') {
        const css = `/* Common styles */
article {
    margin-top: 2rem;
}

/* Result page styles */
.status-badge {
    display: inline-block;
    padding: 0.25rem 0.75rem;
    border-radius: 1rem;
    color: white;
    font-weight: 600;
    margin-bottom: 1rem;
}

.status-badge.success {
    background: #43a047;
}

.status-badge.warning {
    background: #fb8c00;
}

.status-badge.error {
    background: #e53935;
}

code {
    font-weight: normal !important;
}`;
        return new Response(css, {
          headers: {
            'Content-Type': 'text/css',
            'Cache-Control': 'public, max-age=3600'
          }
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

           const cookieHeader = `auth=${authCookie}; HttpOnly; Secure; SameSite=Lax; Max-Age=${oneYear}; Path=/`;

           return new Response('Authentication successful', {
             status: 200,
             headers: {
               'Set-Cookie': cookieHeader
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

       // Show auth page (redirect to home if already authenticated)
       if (pathSegments[0] === 'auth') {
         // Check if user is already authenticated
         const cookies = request.headers.get('Cookie');
         const authCookie = cookies?.split(';')
           .find(c => c.trim().startsWith('auth='))
           ?.split('=').slice(1).join('=');

         const sidCookie = await verifyCookie(authCookie, secretKey);
         if (sidCookie && apiBaseUrl) {
           // Test if the SID is still valid with qBittorrent
           try {
             const testResponse = await fetch(`${apiBaseUrl}/api/v2/app/version`, {
               headers: {
                 'Referer': apiBaseUrl,
                 'Origin': apiBaseUrl,
                 'Cookie': `${sidCookie.name}=${sidCookie.value}`
               }
             });
             if (testResponse.ok) {
               // SID is valid, redirect to home
               return Response.redirect(`${url.origin}/`, 302);
             }
             // SID invalid, clear cookie and show login page
           } catch (error) {
             // SID test failed, clear cookie and show login page
           }
         }

         // Show auth page (clearing any invalid cookie)
         const returnPath = url.searchParams.get('return') || '/';
         const headers = { 'Content-Type': 'text/html' };
         if (sidCookie) {
           // Had a cookie but it was invalid, clear it
           headers['Set-Cookie'] = 'auth=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/';
         }
         return new Response(getAuthPage(returnPath), { headers });
       }

       // Show home page at root if authenticated
       if (pathSegments.length === 0) {
         // Check authentication for root page (skip if qBittorrent auth is configured)
         if (!hasQbAuth) {
           const cookies = request.headers.get('Cookie');
           const authCookie = cookies?.split(';')
             .find(c => c.trim().startsWith('auth='))
             ?.split('=').slice(1).join('=');

           const sidCookie = await verifyCookie(authCookie, secretKey);
           if (!sidCookie) {
             return Response.redirect(`${url.origin}/auth`, 302);
           }
         }
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
             ?.split('=').slice(1).join('=');

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
                 // SID not functional, clear cookie and redirect to auth
                 return new Response('Redirecting to login...', {
                   status: 302,
                   headers: {
                     'Location': `${url.origin}/auth`,
                     'Set-Cookie': `auth=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/`
                   }
                 });
               }
             } catch (error) {
               // Authentication failed, clear cookie and redirect to auth
               return new Response('Redirecting to login...', {
                 status: 302,
                 headers: {
                   'Location': `${url.origin}/auth`,
                   'Set-Cookie': `auth=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/`
                 }
               });
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
          ?.split('=')
          .slice(1)
          .join('=');

        sidCookie = await verifyCookie(authCookie, secretKey);
        if (!sidCookie) {
          // Store the original path to redirect back after auth
          const returnPath = encodeURIComponent(url.pathname + url.search);
          return Response.redirect(`${url.origin}/auth?return=${returnPath}`, 302);
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

      // Check if API request succeeded (HTTP 200)
      if (!addTorrentResponse.ok) {
        const errorText = await addTorrentResponse.text();
        let status;
        let message;

        // HTTP 400 is a warning (torrent may be accepted but not ready)
        if (addTorrentResponse.status === 400) {
          status = 'warning';
          message = 'API Warning';
        } else {
          // 415, 4xx, 5xx are errors
          status = 'error';
          message = 'API Error';
        }

        const result = {
          status: status,
          message: message,
          infohash: null,
          api_error: errorText || 'Unknown error',
          api_status: addTorrentResponse.status,
          files: []
        };

        return new Response(getResultPage(result), {
          status: 200, // Return 200 to browser, show error in UI
          headers: { 'Content-Type': 'text/html' }
        });
      }

      // API returned 200 - torrent was added successfully
      // Now extract infohash and try to fetch file details
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
      let filesFetched = false;
      if (infohash) {
        try {
          // Wait a moment for the torrent to be added to qBittorrent
          await new Promise(resolve => setTimeout(resolve, 1000));

          const filesResponse = await fetch(`${apiBaseUrl}/api/v2/torrents/files?hash=${infohash}`, {
            headers: headers
          });

          if (filesResponse.ok) {
            files = await filesResponse.json();
            filesFetched = files.length > 0;
          }
        } catch (error) {
          // Non-fatal error - just continue without file list
          console.error('Failed to fetch torrent files:', error);
        }
      }

      // Determine final status based on Option A logic:
      // - success: 200 + files fetched
      // - warning: 200 but no files (couldn't get metadata)
      const result = {
        status: filesFetched ? 'success' : 'warning',
        message: filesFetched
          ? 'Magnet added successfully'
          : 'No Files',
        infohash: infohash || 'unknown',
        api_error: !filesFetched && infohash
          ? 'No file details available.'
          : null,
        api_status: null,
        files: files.map(f => ({
          name: f.name,
          size: f.size,
          progress: f.progress
        }))
      };

       return new Response(getResultPage(result), {
         status: 200,
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