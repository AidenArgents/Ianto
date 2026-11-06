(function(root){'use strict';
const {fail,encodeRecord}=root.IantoMarketData;
async function stableUuid(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));const h=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
class FeishuClient {
  constructor(config, fetcher = fetch, tokenCache = null) { this.config = config; this.fetch = fetcher.bind(root); this.cache = tokenCache; this.token = null; this.authenticating = null; }
  async tenantToken() {
    if(this.cache)this.token=await this.cache.get();
    if(this.token?.until>Date.now())return this.token.value;
    if(this.authenticating)return this.authenticating;
    this.authenticating=this.authenticate();
    try{return await this.authenticating;}finally{this.authenticating=null;}
  }
  async authenticate() {
    if (this.token?.until > Date.now()) return this.token.value;
    const r = await this.fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: this.config.appId, app_secret: this.config.appSecret }), signal: AbortSignal.timeout(20000)
    });
    const v = await r.json();
    if (!r.ok || v.code !== 0) throw fail(`飞书应用认证失败（${v.code ?? r.status}）`, 502);
    this.token = { value: v.tenant_access_token, until: Date.now() + (v.expire - 120) * 1000 };
    if(this.cache)await this.cache.set(this.token);
    return this.token.value;
  }
  async request(route, { method = 'GET', body } = {}, retried = false) {
    const token = await this.tenantToken();
    let r;
    try {
      r = await this.fetch('https://open.feishu.cn/open-apis' + route, {
        method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25000)
      });
    } catch { throw fail('飞书网络请求未完成，保留本地记录，稍后核对重试', 502); }
    const v = await r.json();
    if ([99991663,99991664,99991668].includes(v.code) && !retried) { this.token = null; if(this.cache)await this.cache.set(null); return this.request(route, { method, body }, true); }
    if (!r.ok || v.code !== 0) throw fail(`飞书接口失败（${v.code ?? r.status}），请检查授权或稍后重试`, 502);
    return v.data;
  }
  tablePath() { return `/bitable/v1/apps/${encodeURIComponent(this.config.appToken)}/tables/${encodeURIComponent(this.config.tableId)}`; }
  setSchema(info) { this.schema=info; }
  fieldName(source,required=true) {
    if(!this.schema)return source;
    const field=this.schema.fields.find(f=>this.schema.bindings[f.field_id]===source);
    if(!field&&required)throw Error('飞书缺少采集所需字段：'+source);
    return field?.field_name||'';
  }
  recordFields(row) {
    const fields=encodeRecord(row);
    if(!this.schema)return fields;
    this.fieldName('采集编号');
    return Object.fromEntries(Object.entries(fields).flatMap(([source,value])=>{
      const name=this.fieldName(source,false);return name?[[name,value]]:[];
    }));
  }
  async uploadImage(url) {
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw Error('主图链接无效');
    try {
      const imgRes = await this.fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!imgRes.ok) throw Error('主图下载失败（HTTP ' + imgRes.status + '）');
      const contentType=(imgRes.headers.get('content-type') || '').split(';')[0];
      if (!/^image\//i.test(contentType)) throw Error('主图链接未返回图片');
      if (Number(imgRes.headers.get('content-length')) > 20 * 1024 * 1024) throw Error('主图超过 20MB');
      const chunks=[];let size=0;
      for await(const chunk of imgRes.body){size+=chunk.byteLength;if(size>20*1024*1024)throw Error('主图超过 20MB');chunks.push(chunk);}
      if (!size) throw Error('主图为空');
      const buf=new Uint8Array(size);let offset=0;for(const chunk of chunks){buf.set(chunk,offset);offset+=chunk.byteLength;}
      const token = await this.tenantToken();
      const cleanUrl = url.split('?')[0].toLowerCase();
      const extMatch = cleanUrl.match(/\.(jpg|jpeg|png|webp|gif)$/);
      const fileName = 'image.' + (extMatch ? extMatch[1] : ({'image/png':'png','image/webp':'webp','image/gif':'gif'}[contentType] || 'jpg'));
      const formData = new FormData();
      formData.append('file_name', fileName);
      formData.append('parent_type', 'bitable_image');
      formData.append('parent_node', this.config.appToken);
      formData.append('size', String(buf.byteLength));
      formData.append('file', new Blob([buf],{type:contentType}), fileName);
      const upRes = await this.fetch('https://open.feishu.cn/open-apis/drive/v1/medias/upload_all', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token },
        body: formData, signal: AbortSignal.timeout(10000)
      });
      const data = await upRes.json();
      if (!upRes.ok || data.code !== 0 || !data.data?.file_token) throw Error('飞书图片上传失败（' + (data.code ?? upRes.status) + '）');
      return data.data.file_token;
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw Error('主图下载或上传超时');
      throw error;
    }
  }
  async readImage(recordId) {
    const data = await this.request(this.tablePath() + '/records/' + encodeURIComponent(recordId));
    return data.record?.fields?.[this.fieldName('首图')]?.[0]?.file_token || null;
  }
  async attachImage(recordId, token) {
    await this.request(this.tablePath() + '/records/' + encodeURIComponent(recordId), { method: 'PUT', body: { fields: { [this.fieldName('首图')]: [{ file_token: token }] } } });
    if (await this.readImage(recordId) !== token) throw Error('飞书首图附件回读未通过');
  }
  async findRecords(ids) {
    const found = new Map(),name=this.fieldName('采集编号');
    for (let start = 0; start < ids.length; start += 20) {
      const data = await this.request(this.tablePath() + '/records/search?page_size=100', {
        method: 'POST', body: { field_names: [name], filter: { conjunction: 'or', conditions: ids.slice(start,start+20).map(id => ({ field_name: name, operator: 'is', value: [id] })) } }
      });
      for (const record of data.items || []) {
        const value = record.fields[name];
        const id = Array.isArray(value) ? value.map(p=>p.text || '').join('') : String(value || '');
        if (ids.includes(id)) found.set(id, record.record_id);
      }
    }
    return found;
  }
  async writeBatch(batch, { reconcile = false } = {}) {
    const found = reconcile ? await this.findRecords(batch.records.map(r=>r.id)) : new Map();
    const missing = batch.records.filter(r=>!found.has(r.id));
    for (let start = 0; start < missing.length; start += 200) {
      const rows = missing.slice(start,start+200);
      const token = await stableUuid('ianto-capture:' + rows.map(r=>r.id).join(','));
      const data = await this.request(this.tablePath() + '/records/batch_create?client_token=' + token, {
        method: 'POST', body: { records: rows.map(row=>({ fields: this.recordFields(row) })) }
      });
      if (data.records?.length !== rows.length || data.records.some(r=>!r.record_id)) throw fail('飞书返回的保存结果不完整，将保留记录等待核对', 502);
      rows.forEach((row,i)=>found.set(row.id, data.records[i].record_id));
    }
    return batch.records.map(row=>({ id: row.id, recordId: found.get(row.id) }));
  }
  async writeDevelopmentOpinion(receipts,value){
    const name=this.fieldName('开发意见'),bytes=new TextEncoder().encode(value).length+180,step=Math.max(1,Math.min(200,Math.floor(400000/Math.max(1,bytes))));
    const plain=v=>typeof v==='string'?v:Array.isArray(v)?v.map(p=>p.text||'').join(''):v?.text||'';
    for(let start=0;start<receipts.length;start+=step){
      const chunk=receipts.slice(start,start+step),data=await this.request(this.tablePath()+'/records/batch_update',{method:'POST',body:{records:chunk.map(r=>({record_id:r.recordId,fields:{[name]:value}}))}});
      if(!Array.isArray(data.records)||data.records.length!==chunk.length)throw Error('开发意见写入回执不完整，已保留等待重试');
      const returned=new Map(data.records.map(r=>[r.record_id,r]));
      for(const receipt of chunk){const record=returned.get(receipt.recordId);if(!record)throw Error('开发意见回执编号不匹配');let fields=record.fields;if(!Object.hasOwn(fields||{},name))fields=(await this.request(this.tablePath()+'/records/'+encodeURIComponent(receipt.recordId))).record?.fields;if(plain(fields?.[name])!==value)throw Error('开发意见回读不一致，已保留等待重试');}
    }
  }
}

root.IantoMarketFeishu={FeishuClient,stableUuid};
if(typeof module==='object'&&module.exports)module.exports=root.IantoMarketFeishu;
})(globalThis);
