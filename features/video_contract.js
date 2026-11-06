/* Shared pure validation; no account credentials, CDP, or private website APIs. */
globalThis.VceVideoContract = Object.freeze({
  origin(value) {
    const u = new URL(value);
    if (u.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(u.hostname) || u.port !== '4173' || u.username || u.password) throw new Error('只允许本地视频工作台 4173 端口');
    return u.origin;
  },
  provider(value) {
    let u; try { u = new URL(value); } catch { return null; }
    if (u.protocol !== 'https:') return null;
    if (u.hostname === 'app.runwayml.com') return 'runway';
    if (['jimeng.jianying.com', 'jimeng.com', 'www.jimeng.com'].includes(u.hostname)) return 'seedance';
    if (['app.klingai.com', 'klingai.com', 'www.klingai.com'].includes(u.hostname)) return 'kling';
    if (u.hostname === 'flow.google' || (u.hostname === 'labs.google' && u.pathname.startsWith('/fx'))) return 'veo';
    return null;
  },
  jobId(value) {
    if (!/^[a-f0-9]{32}$/.test(value || '')) throw new Error('无效任务 ID');
    return value;
  },
  suffix(value) {
    if (!/^(?:|\/finish|\/status|\/shots\/[a-f0-9]{32}\/(?:image|clip))$/.test(value || '')) throw new Error('超出任务授权范围');
    return value || '';
  }
});
