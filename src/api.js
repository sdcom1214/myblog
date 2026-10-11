export class OnlineClient {
  constructor() { this.user = null; this.revision = 0; this.verified = false; this.wallet = null; this.googleEnabled = false; this.pending = Promise.resolve(); this.error = null; this.generation = 0; }
  async request(path, method = 'GET', body) {
    const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json().catch(() => ({ error: '서버에 연결하지 못했습니다.' }));
    if (!response.ok) { const error = new Error(value.error || '서버 요청에 실패했습니다.'); error.status = response.status; throw error; }
    return value;
  }
  async init() { const value = await this.request('/auth/session'); this.user = value.user; this.googleEnabled = value.googleEnabled; return value; }
  adopt(result) { if (result.user) this.user = result.user; if (Number.isInteger(result.revision)) this.revision = result.revision; if ('verified' in result) this.verified = result.verified; if (result.wallet) this.wallet = result.wallet; this.error = null; return result; }
  enqueue(operation) {
    const generation = this.generation;
    const task = this.pending.catch(() => {}).then(() => { if (generation !== this.generation) throw new Error('로그인 계정이 변경됐습니다.'); return operation(); });
    this.pending = task; return task;
  }
  save(data) {
    const snapshot = structuredClone(data);
    return this.enqueue(async () => {
      if (this.error) throw this.error;
      try { return this.adopt(await this.request('/save', 'PUT', { data: snapshot, revision: this.revision })); }
      catch (error) { this.error = error; throw error; }
    });
  }
  command(command, args = {}) { return this.enqueue(async () => { if (this.error) throw this.error; return this.adopt(await this.request('/career/action', 'POST', { command, args, revision: this.revision })); }); }
  async restore() { await this.pending.catch(() => {}); return this.adopt(await this.request('/save')); }
  async authenticate(mode, fields) {
    await this.pending.catch(() => {}); this.generation++;
    const result = await this.request(`/auth/${mode}`, 'POST', fields);
    const session = await this.request('/auth/session');
    if (session.user?.id !== result.user.id) throw new Error('로그인 쿠키를 사용할 수 없습니다. Safari 또는 Chrome에서 같은 계정으로 로그인해 주세요.');
    return this.adopt(result);
  }
  async logout() { await this.pending.catch(() => {}); await this.request('/auth/logout', 'POST', {}); this.generation++; this.user = null; this.verified = false; this.wallet = null; this.error = null; }
}
