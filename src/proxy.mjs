export function parseMacHttpsProxy(output) {
  const enabled = /^\s*HTTPSEnable\s*:\s*1\s*$/m.test(output);
  const host = output.match(/^\s*HTTPSProxy\s*:\s*(\S+)\s*$/m)?.[1];
  const port = output.match(/^\s*HTTPSPort\s*:\s*(\d+)\s*$/m)?.[1];
  if (!enabled || !host || !port) return null;
  return `http://${host}:${port}`;
}

export function resolveProxyBootstrapEnv(options = {}) {
  const env = options.env || process.env;
  if (env.NODE_USE_ENV_PROXY === '1') return null;
  const configuredProxy = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  if (configuredProxy) {
    return {
      ...env,
      NODE_USE_ENV_PROXY: '1',
    };
  }
  const platform = options.platform || process.platform;
  if (platform !== 'darwin' || !options.queryMacProxy) return null;
  try {
    const proxy = parseMacHttpsProxy(options.queryMacProxy());
    if (!proxy) return null;
    return {
      ...env,
      HTTP_PROXY: proxy,
      HTTPS_PROXY: proxy,
      NODE_USE_ENV_PROXY: '1',
    };
  } catch {
    return null;
  }
}
