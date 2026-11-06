/* Optional continuous mode: register named materials once, then reuse the conversation. */
(function () {
  'use strict';
  if (globalThis.IantoMaterialSession) return;
  const STORE = 'ianto.web-material-session.v1';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  function read() { try { return JSON.parse(sessionStorage.getItem(STORE) || 'null'); } catch (_) { return null; } }
  function save(state) { state.url = location.href; sessionStorage.setItem(STORE, JSON.stringify(state)); }
  async function prepare(job, adapter) {
    if (job.uploadMode !== 'continuous') return;
    if (!job.materialKey) throw new Error('[MATERIAL_SETUP] 连续模式缺少素材库');
    let state = read();
    if (state?.key === job.materialKey && state.conversation === job.conversationKey && state.ready && state.url !== location.href) {
      let samePath = false;
      try { samePath = new URL(state.url).pathname === new URL(location.href).pathname; } catch (_) {}
      const finalToken = 'MATERIAL_ACK_' + job.materialKey.replace(/[^a-z0-9]/gi, '').slice(0, 12) + '_' + Math.max(0, Number(state.total) - 1);
      const confirmedInCurrentConversation = (adapter.replies?.() || []).some(node => String(node.innerText || node.textContent || '').includes(finalToken));
      if (samePath || confirmedInCurrentConversation) { state.url = location.href; save(state); }
      else throw new Error('[MATERIAL_SETUP] 页面已离开登记素材的会话；系统无法确认原素材仍在当前会话');
    }
    if (!state || state.key !== job.materialKey || state.conversation !== job.conversationKey) {
      state = { key: job.materialKey, conversation: job.conversationKey, next: 0, pending: null, pendingIndex: null, ready: false }; save(state);
    }
    if (job.materialOnly) {
      const index = Number(job.materialIndex), total = Number(job.materialCount);
      if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index < 0 || index >= total) throw new Error('[MATERIAL_SETUP] 素材分批编号无效');
      if (state.ready) return;
      if (state.total != null && state.total !== total) throw new Error('[MATERIAL_SETUP] 素材分批总数发生变化，请重建素材会话');
      state.total = total;
      if (state.pending) {
        await receipt(state.pending);
        state.next = Math.max(Number(state.next) || 0, (Number(state.pendingIndex) || 0) + 1);
        state.pending = null; state.pendingIndex = null; save(state);
      }
      const tokenFor = batchIndex => 'MATERIAL_ACK_' + job.materialKey.replace(/[^a-z0-9]/gi, '').slice(0, 12) + '_' + batchIndex;
      const visibleReplies = (adapter.replies?.() || []).map(node => String(node.innerText || node.textContent || '')).join('\n');
      if (state.next <= index && visibleReplies.includes(tokenFor(index))) {
        await receipt(tokenFor(index));
        state.next = index + 1; state.ready = state.next === total; state.pending = null; state.pendingIndex = null; save(state);
        return;
      }
      if (state.next < index) {
        for (let priorIndex = state.next; priorIndex < index; priorIndex++) {
          if (!visibleReplies.includes(tokenFor(priorIndex))) break;
          state.next = priorIndex + 1;
        }
        save(state);
      }
      if (state.next > index) return;
      if (state.next < index) throw new Error('[MATERIAL_SETUP] 素材批次顺序不连续，请重试当前图片');
      const images = Array.isArray(job.images) ? job.images : [];
      if (!job.materialFinalRules && !images.length) throw new Error('[MATERIAL_SETUP] 当前素材批次没有图片');
      const token = tokenFor(index);
      const roleLabels = { product: '产品 A（商品外观）', reference: '参考 B（场景/风格效果）', model: '模特 C（人物身份）' };
      const text = job.materialFinalRules
        ? '素材登记完成。此消息仅设置后续规则，不生成图片。\n素材清单：\n' + String(job.materialManifest || '') + '\n规则：产品 A 图是商品外观、颜色、结构、标签和数量的唯一依据；参考 B 图只控制构图、姿势、光线、场景和风格，不带入参考图里的旧产品、人物身份、Logo或文案；模特 C 图只决定人物身份、体型和外貌，不能把模特照片里的原穿着当成产品。优先级：A 产品真实性 > C 模特身份一致性 > B 视觉效果。C 类中不同人物应视为候选模特，不融合人脸；未指定人物编号时按任务选择一个并保持一致。后续每次仅生成当前任务的一张图，不把多张任务拼在一起。平台、语言和比例以各次任务为准。\n' + (job.materialRules || '') + '\n现在只回复 ' + token
        : '素材登记，暂不作图。以下 ' + images.length + ' 张属于 ' + (roleLabels[job.materialRole] || job.materialRole || '当前素材') + '，按附件文件名建立编号：\n' + images.map(image => image.name).join('\n') + '\n仅接收素材，不改图、不生图。只回复 ' + token;
      adapter.status('连续模式：登记素材 ' + (index + 1) + '/' + total);
      await adapter.reset?.();
      if (images.length) await adapter.upload(images);
      state.pending = token; state.pendingIndex = index; save(state);
      await adapter.send(text);
      await receipt(token);
      state.pending = null; state.pendingIndex = null; state.next = index + 1; state.ready = state.next === total; save(state);
      return;
    }
    if (state.ready) { adapter.status('连续模式：复用已登记的三类素材，不重复上传'); return; }
    if (!job.images?.length) throw new Error('[MATERIAL_MISSING] 当前网页会话没有已登记素材；请重新交接原图后继续');
    const batches = [];
    const roleLabels = { product: '产品 A（商品外观）', reference: '参考 B（场景/风格效果）', model: '模特 C（人物身份）' };
    for (const role of ['product', 'reference', 'model']) {
      const images = job.images.filter(image => image.role === role);
      for (let start = 0; start < images.length; start += 5) batches.push({ role, images: images.slice(start, start + 5) });
    }
    const manifest = job.images.map(image => image.name.replace(/\.[^.]+$/, '') + ': ' + image.role).join('\n');
    batches.push({ images: [], rules: true });
    async function receipt(token) {
      const deadline = Date.now() + 120000;
      let stable = 0, last = '';
      while (Date.now() < deadline) {
        const response = adapter.replies().findLast(node => String(node.innerText || node.textContent || '').includes(token));
        const text = response ? String(response.innerText || response.textContent || '') : '';
        if (text && text === last && !adapter.busy()) { if (!stable) stable = Date.now(); if (Date.now() - stable >= 1800) return; }
        else stable = 0;
        last = text;
        await sleep(400);
      }
      throw new Error('[MATERIAL_SETUP] 素材登记尚未收到确认；重试会先等待原回执。需要重新开始时，请点击“重建素材会话”。');
    }
    if (state.pending) { await receipt(state.pending); state.next++; state.pending = null; save(state); }
    for (; state.next < batches.length; state.next++) {
      const batch = batches[state.next];
      const token = 'MATERIAL_ACK_' + job.materialKey.replace(/[^a-z0-9]/gi, '').slice(0, 12) + '_' + state.next;
      const text = batch.rules
        ? '素材登记完成。此消息仅设置后续规则，不生成图片。\n素材清单：\n' + manifest + '\n规则：产品 A 图是商品外观、颜色、结构、标签和数量的唯一依据；参考 B 图只控制构图、姿势、光线、场景和风格，不带入参考图里的旧产品、人物身份、Logo或文案；模特 C 图只决定人物身份、体型和外貌，不能把模特照片里的原穿着当成产品。优先级：A 产品真实性 > C 模特身份一致性 > B 视觉效果。C 类中不同人物应视为候选模特，不融合人脸；未指定人物编号时按任务选择一个并保持一致。后续每次仅生成当前任务的一张图，不把多张任务拼在一起。平台、语言和比例以各次任务为准。\n' + (job.materialRules || '') + '\n现在只回复 ' + token
        : '素材登记，暂不作图。以下 ' + batch.images.length + ' 张属于 ' + (roleLabels[batch.role] || batch.role) + '，按附件文件名建立编号：\n' + batch.images.map(image => image.name).join('\n') + '\n仅接收素材，不改图、不生图。只回复 ' + token;
      adapter.status('连续模式：登记素材 ' + (state.next + 1) + '/' + batches.length);
      await adapter.reset?.();
      if (batch.images.length) await adapter.upload(batch.images);
      state.pending = token; save(state);
      await adapter.send(text);
      await receipt(token);
      state.pending = null; save({ ...state, next: state.next + 1 });
    }
    state.ready = true; save(state);
  }
  globalThis.IantoMaterialSession = { prepare };
})();
