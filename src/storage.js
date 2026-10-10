import { validateCareer } from './engine.js';

export const STORAGE_KEY = 'second-life-football-v1';
export const emptyStore = () => ({ version: 1, current: null, archives: [], coins: 100, inventory: [], theme: 'green', muted: true, matches: [] });
export function validateStore(value) {
  return value?.version === 1 && (value.current === null || validateCareer(value.current)) &&
    Array.isArray(value.archives) && value.archives.length <= 100 && value.archives.every(validateCareer) &&
    Number.isFinite(value.coins) && value.coins >= 0 && Array.isArray(value.inventory) && value.inventory.every(x => ['boots', 'recovery', 'kit'].includes(x)) &&
    ['green', 'blue', 'burgundy'].includes(value.theme) && typeof value.muted === 'boolean' && Array.isArray(value.matches) && value.matches.length <= 100;
}
export function parseSave(text) {
  if (typeof text !== 'string' || text.length > 5_000_000) throw new Error('파일 크기는 5MB 이하여야 합니다.');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('올바른 JSON 저장 파일이 아닙니다.'); }
  if (value.format === 'sfc-career' && value.version === 1 && validateCareer(value.career)) return { type: 'career', value: value.career };
  if (value.format === 'sfc-save' && validateStore(value.data)) return { type: 'save', value: value.data };
  throw new Error('이 게임에서 내보낸 유효한 파일을 선택해 주세요.');
}
export function loadStore(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { data: emptyStore(), error: null };
    const data = JSON.parse(raw);
    if (!validateStore(data)) throw new Error('invalid');
    return { data, error: null };
  } catch { return { data: emptyStore(), error: '저장 기록을 읽을 수 없습니다. 기존 파일은 보존됩니다. 새 기록을 만들기 전에 설정에서 백업해 주세요.' }; }
}
export function serializeSave(data) { return JSON.stringify({ format: 'sfc-save', version: 1, data }, null, 2); }
export function serializeCareer(career) { return JSON.stringify({ format: 'sfc-career', version: 1, career }, null, 2); }
